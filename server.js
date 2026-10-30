import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const allowedBaseUrls = new Set([
  'https://uscst-pos.gsc.vficloud.net/oidc',
  'https://cstpos.test-gsc.vfims.com/oidc',
]);
const sensitiveField =
  /authorization|api.?key|password|pan|primary.?account.?number|card.?number|track|cvv|security.?code|token|sale.?to.?poi.?data/i;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function loadEnvironment(environment = process.env) {
  let contents;
  try {
    contents = readFileSync(path.join(directory, '.env'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const [name, value] of Object.entries(parseEnvFile(contents))) {
    if (environment[name] === undefined) environment[name] = value;
  }
}

function readSaleSession(sessionPath) {
  if (!sessionPath) return {};
  try {
    const state = JSON.parse(readFileSync(sessionPath, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('Invalid sale session state.');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('Could not read the local sale session state.');
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveField.test(key) ? '[REDACTED]' : sanitize(child),
      ]),
    );
  }
  return value;
}

function isTrustedOrigin(origin, localPort) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
      parsed.port === String(localPort)
    );
  } catch {
    return false;
  }
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function readConfig(environment = process.env) {
  const baseUrl = (environment.VF_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const apiUser = (environment.VF_API_USER ?? '').trim();
  const apiKey = (environment.VF_API_KEY ?? '').trim();
  const rawPoiId = (environment.VF_POI_ID ?? '').trim();
  const poiId = rawPoiId.startsWith('replace-with-') ? '' : rawPoiId;
  const rawSiteEntityId = (environment.VF_SITE_ENTITY_ID ?? '').trim();
  const siteEntityId = rawSiteEntityId.startsWith('replace-with-')
    ? ''
    : rawSiteEntityId;
  const serialNumber =
    (environment.VF_SERIAL_NUMBER ?? '').trim() || '552-322-068';
  const v660pSerialNumber =
    (environment.VF_V660P_SERIAL_NUMBER ?? '').trim() || '713-363-458';
  const paymentTimeoutMs = Number(environment.VF_PAYMENT_TIMEOUT_MS ?? 180000);

  if (!allowedBaseUrls.has(baseUrl)) {
    throw new Error('VF_BASE_URL must be a documented POS Cloud sandbox URL.');
  }
  if (
    !apiUser ||
    !apiKey ||
    apiUser.startsWith('replace-with-') ||
    apiKey.startsWith('replace-with-')
  ) {
    throw new Error(
      'Set VF_API_USER and VF_API_KEY in .env before starting the console.',
    );
  }
  if (!serialNumber) {
    throw new Error('VF_SERIAL_NUMBER must identify the target terminal.');
  }
  if (
    !Number.isInteger(paymentTimeoutMs) ||
    paymentTimeoutMs < 90000 ||
    paymentTimeoutMs > 300000
  ) {
    throw new Error('VF_PAYMENT_TIMEOUT_MS must be between 90000 and 300000.');
  }

  return {
    baseUrl,
    apiUser,
    apiKey,
    poiId,
    siteEntityId,
    serialNumber,
    v660pSerialNumber,
    paymentTimeoutMs,
  };
}

export function createServer(
  config,
  fetchImpl = globalThis.fetch,
  sessionPath = null,
) {
  const authorization = `Basic ${Buffer.from(`${config.apiUser}:${config.apiKey}`, 'utf8').toString('base64')}`;
  const savedSession = readSaleSession(sessionPath);
  const terminals = [
    { id: 'p630', name: 'P630', serialNumber: config.serialNumber },
    {
      id: 'v660p',
      name: 'V660p',
      serialNumber: config.v660pSerialNumber ?? '713-363-458',
    },
  ];
  let saleInFlight = false;
  let saleOutcomeUnknown =
    savedSession.saleOutcomeUnknown === true ||
    savedSession.saleInFlight === true;
  let saleCompleted =
    savedSession.saleCompleted === true || savedSession.saleInFlight === true;
  let lastPaymentReference = savedSession.lastPaymentReference ?? null;
  let lastPaymentSiteEntityId = savedSession.lastPaymentSiteEntityId ?? null;
  let lastPaymentOutcome = savedSession.lastPaymentOutcome ?? null;
  let transactionStatusAvailable =
    savedSession.transactionStatusAvailable === true ||
    (savedSession.saleInFlight === true && Boolean(lastPaymentReference));

  function persistSaleSession() {
    if (!sessionPath) return;
    const temporaryPath = `${sessionPath}.tmp`;
    writeFileSync(
      temporaryPath,
      JSON.stringify({
        saleInFlight,
        saleOutcomeUnknown,
        saleCompleted,
        lastPaymentReference,
        lastPaymentSiteEntityId,
        lastPaymentOutcome,
        transactionStatusAvailable,
      }),
      'utf8',
    );
    renameSync(temporaryPath, sessionPath);
  }

  async function callVerifone(
    endpoint,
    { method = 'GET', body, headers = {}, timeoutMs = 20000 } = {},
  ) {
    let upstream;
    try {
      upstream = await fetchImpl(`${config.baseUrl}${endpoint}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const error = new Error('Could not confirm the Verifone response.');
      error.ambiguous = method === 'POST';
      error.cause = cause;
      throw error;
    }

    let text;
    try {
      text = await upstream.text();
    } catch (cause) {
      const error = new Error('Could not read the Verifone response.');
      error.ambiguous = method === 'POST';
      error.cause = cause;
      throw error;
    }
    let bodyData = null;
    if (text) {
      try {
        bodyData = sanitize(JSON.parse(text));
      } catch {
        bodyData = { nonJsonResponse: true };
      }
    }
    return { status: upstream.status, ok: upstream.ok, body: bodyData };
  }

  async function checkTerminal(serialNumber = config.serialNumber) {
    // Source: Health Check, https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/health-check
    const result = await callVerifone(
      `/poscloud/nexo/status/${encodeURIComponent(serialNumber)}`,
    );
    const poiList = Array.isArray(result.body?.POIStatus)
      ? result.body.POIStatus
      : [];
    const entry = poiList.find(poi => poi.serialNumber === serialNumber);
    const terminal = entry
      ? {
          POIID: entry.POIID ?? null,
          entityUID: entry.entityUID ?? null,
          POIState: entry.POIState ?? null,
          serialNumber: entry.serialNumber ?? null,
          deviceModel: entry.deviceModel ?? null,
          deviceSoftwareVersion: entry.deviceSoftwareVersion ?? null,
          lastDateTimeConnected: entry.lastDateTimeConnected ?? null,
        }
      : null;
    return {
      ...result,
      terminal,
      serviceResult: result.body?.Response?.Result ?? null,
    };
  }

  return createHttpServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );

    try {
      const url = new URL(request.url, 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/api/config') {
        return writeJson(response, 200, {
          poiId: config.poiId,
          serialNumber: config.serialNumber,
          terminals,
          paymentTimeoutSeconds: Math.floor(config.paymentTimeoutMs / 1000),
          siteEntityIdConfigured: Boolean(config.siteEntityId),
          transactionStatusAvailable,
          outcomeUnknown: saleOutcomeUnknown,
          saleCompleted,
          canStartAnotherSale:
            saleCompleted &&
            lastPaymentOutcome === 'SUCCESS' &&
            !saleOutcomeUnknown &&
            !saleInFlight,
        });
      }

      if (
        request.method === 'POST' &&
        [
          '/api/status',
          '/api/sale',
          '/api/transaction-status',
          '/api/new-sale',
        ].includes(url.pathname)
      ) {
        if (
          !isTrustedOrigin(request.headers.origin, request.socket.localPort)
        ) {
          return writeJson(response, 403, {
            error: 'Requests must come from this local console.',
          });
        }
        const body = await readJsonBody(request);

        if (url.pathname === '/api/status') {
          const terminalId =
            typeof body.terminalId === 'string' ? body.terminalId : 'p630';
          const selectedTerminal = terminals.find(
            terminal => terminal.id === terminalId,
          );
          if (!selectedTerminal) {
            return writeJson(response, 400, {
              error: 'Select a configured terminal.',
            });
          }
          try {
            const result = await checkTerminal(selectedTerminal.serialNumber);
            if (!result.ok) {
              return writeJson(response, 502, {
                error: 'POS Cloud rejected the status request.',
                upstreamStatus: result.status,
                body: result.body,
              });
            }
            if (!result.terminal) {
              return writeJson(response, 404, {
                error:
                  'No POI status matched the configured terminal serial number.',
                upstreamStatus: result.status,
                body: result.body,
              });
            }
            return writeJson(response, 200, {
              upstreamStatus: result.status,
              serviceResult: result.serviceResult,
              terminalId: selectedTerminal.id,
              terminalName: selectedTerminal.name,
              configuredPoiId:
                selectedTerminal.id === 'p630' ? config.poiId : '',
              terminal: result.terminal,
            });
          } catch {
            return writeJson(response, 502, {
              error: 'Could not reach the POS Cloud status endpoint.',
            });
          }
        }

        if (url.pathname === '/api/transaction-status') {
          if (!transactionStatusAvailable || !lastPaymentReference) {
            return writeJson(response, 409, {
              error: 'No sale from this session is available to check.',
              transactionStatusAvailable: false,
            });
          }

          const transactionStatusRequest = {
            MessageHeader: {
              MessageClass: 'SERVICE',
              MessageCategory: 'TRANSACTIONSTATUS',
              MessageType: 'REQUEST',
              ServiceID: randomUUID(),
              SaleID: lastPaymentReference.SaleID,
              POIID: lastPaymentReference.POIID,
            },
            TransactionStatusRequest: {
              DocumentQualifier: 'SALERECEIPT',
              MessageReference: lastPaymentReference,
            },
          };

          try {
            const result = await callVerifone(
              '/poscloud/nexo/v2/transactionstatus',
              {
                method: 'POST',
                body: transactionStatusRequest,
                headers: { 'x-site-entity-id': lastPaymentSiteEntityId },
              },
            );
            if (!result.ok) {
              return writeJson(response, 502, {
                error: 'POS Cloud rejected the transaction status request.',
                upstreamStatus: result.status,
                body: result.body,
                transactionStatusAvailable,
                outcomeUnknown: saleOutcomeUnknown,
              });
            }

            const transactionResult =
              result.body?.TransactionStatusResponse?.RepeatedMessageResponse
                ?.RepeatedResponseMessageBody?.PaymentResponse?.Response
                ?.Result ?? null;
            if (['SUCCESS', 'FAILURE', 'PARTIAL'].includes(transactionResult)) {
              saleOutcomeUnknown = false;
              lastPaymentOutcome = transactionResult;
              saleCompleted = transactionResult !== 'FAILURE';
              persistSaleSession();
            }

            return writeJson(response, 200, {
              upstreamStatus: result.status,
              transactionResult,
              retryAllowed: transactionResult === 'FAILURE',
              canStartAnotherSale:
                transactionResult === 'SUCCESS' && !saleOutcomeUnknown,
              transactionStatusAvailable,
              outcomeUnknown: saleOutcomeUnknown,
              body: result.body,
            });
          } catch {
            return writeJson(response, 502, {
              error:
                'Could not reach the POS Cloud transaction status endpoint.',
              transactionStatusAvailable,
              outcomeUnknown: saleOutcomeUnknown,
            });
          }
        }

        if (url.pathname === '/api/new-sale') {
          if (saleInFlight || saleOutcomeUnknown) {
            return writeJson(response, 409, {
              error:
                'Resolve the current transaction before starting another sale.',
              outcomeUnknown: saleOutcomeUnknown,
            });
          }
          if (!saleCompleted || lastPaymentOutcome !== 'SUCCESS') {
            return writeJson(response, 409, {
              error:
                'A new sale can be started only after Transaction Status confirms SUCCESS.',
              canStartAnotherSale: false,
            });
          }

          saleCompleted = false;
          lastPaymentReference = null;
          lastPaymentSiteEntityId = null;
          lastPaymentOutcome = null;
          transactionStatusAvailable = false;
          persistSaleSession();
          return writeJson(response, 200, {
            ready: true,
            canStartAnotherSale: false,
            transactionStatusAvailable: false,
          });
        }

        const saleTerminalId =
          typeof body.terminalId === 'string' ? body.terminalId : 'p630';
        const saleTerminal = terminals.find(
          terminal => terminal.id === saleTerminalId,
        );
        if (!saleTerminal) {
          return writeJson(response, 400, {
            error: 'Select a configured terminal.',
          });
        }

        if (saleInFlight) {
          return writeJson(response, 409, {
            error: 'A sale request is already in progress.',
          });
        }
        if (saleOutcomeUnknown) {
          return writeJson(response, 409, {
            error:
              'The previous sale outcome is unknown. Verify it before making another payment.',
          });
        }
        if (saleCompleted) {
          return writeJson(response, 409, {
            error:
              'A sale response was already received in this session. Verify it before restarting the app.',
          });
        }

        const requestedPoiId =
          typeof body.poiId === 'string' ? body.poiId.trim() : '';
        if (saleTerminal.id === 'p630') {
          if (!config.poiId) {
            return writeJson(response, 409, {
              error:
                'Set VF_POI_ID to the exact POIID returned by the status API before sending a sale.',
            });
          }
          if (!config.siteEntityId) {
            return writeJson(response, 409, {
              error:
                'Set VF_SITE_ENTITY_ID to the entity UUID returned by the status API before sending a sale.',
            });
          }
          if (requestedPoiId !== config.poiId) {
            return writeJson(response, 400, {
              error: 'The selected POIID must match VF_POI_ID.',
            });
          }
        } else if (!requestedPoiId) {
          return writeJson(response, 400, {
            error: 'Check the selected terminal status before sending a sale.',
          });
        }

        saleInFlight = true;
        try {
          const status = await checkTerminal(saleTerminal.serialNumber);
          if (!status.ok) {
            return writeJson(response, 502, {
              error: 'Pre-sale status check failed; no payment was sent.',
              upstreamStatus: status.status,
              body: status.body,
            });
          }
          if (status.serviceResult !== 'SUCCESS') {
            return writeJson(response, 409, {
              error:
                'POS Cloud health check was not successful; no payment was sent.',
              serviceResult: status.serviceResult,
            });
          }
          if (!status.terminal) {
            return writeJson(response, 409, {
              error: `No POI matches the ${saleTerminal.name} serial; no payment was sent.`,
            });
          }
          if (status.terminal.POIState !== 'CONNECTED') {
            return writeJson(response, 409, {
              error: `Terminal state is ${status.terminal.POIState ?? 'unknown'}; no payment was sent.`,
              terminal: status.terminal,
            });
          }
          if (
            saleTerminal.id === 'p630' &&
            status.terminal.POIID !== config.poiId
          ) {
            return writeJson(response, 409, {
              error:
                'VF_POI_ID must exactly match the POIID returned by the status API, including its prefix; no payment was sent.',
              terminal: status.terminal,
            });
          }
          if (status.terminal.POIID !== requestedPoiId) {
            return writeJson(response, 409, {
              error:
                'The selected POIID no longer matches the fresh status response; no payment was sent.',
              terminal: status.terminal,
            });
          }

          const salePoiId = status.terminal.POIID;
          const saleSiteEntityId =
            saleTerminal.id === 'p630'
              ? config.siteEntityId
              : status.terminal.entityUID;
          if (!saleSiteEntityId) {
            return writeJson(response, 409, {
              error: `The ${saleTerminal.name} status response did not include an entity UUID; no payment was sent.`,
              terminal: status.terminal,
            });
          }

          const serviceId = randomUUID();
          const transactionId = randomUUID();
          const transactionTimestamp = new Date().toISOString();
          lastPaymentReference = {
            MessageCategory: 'PAYMENT',
            ServiceID: serviceId,
            SaleID: 'VERIFONEPOS',
            POIID: salePoiId,
          };
          lastPaymentOutcome = null;
          lastPaymentSiteEntityId = saleSiteEntityId;
          transactionStatusAvailable = false;
          // Source: Sale, https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/payments/sale
          // Source: Points of Interaction, https://docs.verifone.com/verifone-central-getting-started/verifone-central/administration-tools/points-of-interaction
          const paymentRequest = {
            MessageHeader: {
              MessageClass: 'SERVICE',
              MessageCategory: 'PAYMENT',
              MessageType: 'REQUEST',
              POIID: salePoiId,
              SaleID: 'VERIFONEPOS',
              ServiceID: serviceId,
            },
            PaymentRequest: {
              SaleData: {
                SaleTransactionID: {
                  TransactionID: transactionId,
                  TimeStamp: transactionTimestamp,
                },
              },
              PaymentTransaction: {
                AmountsReq: { Currency: 'USD', RequestedAmount: '1.00' },
              },
            },
          };

          saleCompleted = true;
          saleOutcomeUnknown = true;
          transactionStatusAvailable = true;
          persistSaleSession();
          const result = await callVerifone('/poscloud/nexo/v2/payment', {
            method: 'POST',
            body: paymentRequest,
            headers: { 'x-site-entity-id': saleSiteEntityId },
            timeoutMs: config.paymentTimeoutMs,
          });
          if (!result.ok) {
            saleInFlight = false;
            saleOutcomeUnknown = result.status >= 500;
            transactionStatusAvailable = true;
            persistSaleSession();
            return writeJson(response, 502, {
              error:
                result.status >= 500
                  ? 'Verifone returned a server error. The payment outcome may be unknown; verify before retrying.'
                  : 'POS Cloud rejected the sale request.',
              upstreamStatus: result.status,
              body: result.body,
              outcomeUnknown: result.status >= 500,
              transactionStatusAvailable,
            });
          }

          saleInFlight = false;
          saleCompleted = true;
          saleOutcomeUnknown = false;
          transactionStatusAvailable = true;
          persistSaleSession();
          return writeJson(response, 200, {
            upstreamStatus: result.status,
            request: {
              amount: '1.00',
              currency: 'USD',
              POIID: salePoiId,
              ServiceID: serviceId,
              SaleTransactionID: {
                TransactionID: transactionId,
                TimeStamp: transactionTimestamp,
              },
            },
            transactionStatusAvailable,
            body: result.body,
          });
        } catch (error) {
          saleInFlight = false;
          if (error.ambiguous) {
            saleOutcomeUnknown = true;
            transactionStatusAvailable = true;
          }
          persistSaleSession();
          return writeJson(response, 502, {
            error: error.ambiguous
              ? 'No response arrived. The payment outcome is unknown; verify before retrying.'
              : 'Could not complete the pre-sale status check; no payment was sent.',
            outcomeUnknown: Boolean(error.ambiguous),
            transactionStatusAvailable,
          });
        } finally {
          saleInFlight = false;
        }
      }

      if (request.method === 'GET' && staticFiles.has(url.pathname)) {
        const [filename, contentType] = staticFiles.get(url.pathname);
        response.writeHead(200, { 'Content-Type': contentType });
        return response.end(
          readFileSync(path.join(directory, 'public', filename)),
        );
      }

      return writeJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      return writeJson(response, error.statusCode ?? 500, {
        error: error.statusCode
          ? error.message
          : 'The local console could not handle the request.',
      });
    }
  });
}

function start() {
  try {
    loadEnvironment();
    const config = readConfig();
    const sessionPath = path.join(directory, 'logs', 'sale-session.json');
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be a valid TCP port.');
    }
    createServer(config, globalThis.fetch, sessionPath).listen(
      port,
      '127.0.0.1',
      () => {
        console.log(`Local Verifone console ready at http://127.0.0.1:${port}`);
      },
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  start();
}
