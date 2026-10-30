import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer, readConfig } from '../server.js';

const testConfig = {
  baseUrl: 'https://uscst-pos.gsc.vficloud.net/oidc',
  apiUser: 'test-user',
  apiKey: 'test-key',
  poiId: 'POI 0200240550006587',
  siteEntityId: '11111111-2222-4333-8444-555555555555',
  serialNumber: '552-322-068',
  v660pSerialNumber: '713-363-458',
  paymentTimeoutMs: 180000,
};

async function withServer(server, run) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}
function statusResponse(
  state = 'CONNECTED',
  serialNumber = '552-322-068',
  poiId = 'POI 0200240550006587',
  entityUID = testConfig.siteEntityId,
) {
  return Response.json({
    Response: { Result: 'SUCCESS' },
    POIStatus: [
      {
        POIID: poiId,
        entityUID,
        POIState: state,
        serialNumber,
        deviceModel: serialNumber === '552-322-068' ? 'P630' : 'V660p',
      },
    ],
  });
}

test('uses the P630 default when VF_SERIAL_NUMBER is blank and rejects production URLs', () => {
  const config = readConfig({
    VF_BASE_URL: 'https://uscst-pos.gsc.vficloud.net/oidc',
    VF_API_USER: 'test-user',
    VF_API_KEY: 'test-key',
    VF_POI_ID: 'POI 0200240550006587',
    VF_SITE_ENTITY_ID: testConfig.siteEntityId,
    VF_SERIAL_NUMBER: '',
    VF_V660P_SERIAL_NUMBER: '',
  });
  assert.equal(config.serialNumber, '552-322-068');
  assert.equal(config.v660pSerialNumber, '713-363-458');
  assert.equal(config.poiId, 'POI 0200240550006587');
  assert.equal(config.siteEntityId, testConfig.siteEntityId);
  assert.throws(
    () =>
      readConfig({
        VF_BASE_URL: 'https://us.pos-gsc.verifone.cloud/oidc',
        VF_API_USER: 'test-user',
        VF_API_KEY: 'test-key',
      }),
    /sandbox URL/,
  );
});
async function post(origin, route, body = {}) {
  return fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

test('serves the local console without exposing credentials', async () => {
  await withServer(createServer(testConfig), async origin => {
    const [page, config] = await Promise.all([
      fetch(origin),
      fetch(`${origin}/api/config`),
    ]);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Terminal console/);
    assert.deepEqual(await config.json(), {
      poiId: 'POI 0200240550006587',
      serialNumber: '552-322-068',
      terminals: [
        { id: 'p630', name: 'P630', serialNumber: '552-322-068' },
        { id: 'v660p', name: 'V660p', serialNumber: '713-363-458' },
      ],
      paymentTimeoutSeconds: 180,
      siteEntityIdConfigured: true,
      transactionStatusAvailable: false,
      outcomeUnknown: false,
      saleCompleted: false,
      canStartAnotherSale: false,
    });
  });
});

test('checks status by serial number and returns the POIID', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statusResponse();
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const response = await post(origin, '/api/status');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.terminal.POIID, 'POI 0200240550006587');
    assert.equal(body.terminal.entityUID, testConfig.siteEntityId);
    assert.equal(body.configuredPoiId, testConfig.poiId);
    assert.equal(body.terminal.POIState, 'CONNECTED');
    assert.equal(
      calls[0].url,
      `${testConfig.baseUrl}/poscloud/nexo/status/552-322-068`,
    );
    assert.equal(
      calls[0].options.headers.Authorization.startsWith('Basic '),
      true,
    );
  });
});

test('checks V660p status using its own serial without configuring a sale POIID', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statusResponse(
      'CONNECTED',
      testConfig.v660pSerialNumber,
      'POI V660P-TEST',
      testConfig.siteEntityId,
    );
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const response = await post(origin, '/api/status', {
      terminalId: 'v660p',
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(
      calls[0].url,
      `${testConfig.baseUrl}/poscloud/nexo/status/713-363-458`,
    );
    assert.equal(body.terminalId, 'v660p');
    assert.equal(body.terminalName, 'V660p');
    assert.equal(body.configuredPoiId, '');
    assert.equal(body.terminal.serialNumber, testConfig.v660pSerialNumber);
    assert.equal(body.terminal.POIID, 'POI V660P-TEST');
  });
});

test('sends V660p sale using the POIID and entity UUID from fresh status', async () => {
  const calls = [];
  const v660pPoiId = 'POI V660P-TEST';
  const v660pEntityId = '22222222-3333-4444-8555-666666666666';
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status/713-363-458')) {
      return statusResponse(
        'CONNECTED',
        testConfig.v660pSerialNumber,
        v660pPoiId,
        v660pEntityId,
      );
    }
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
    });
  };

  await withServer(
    createServer({ ...testConfig, poiId: '', siteEntityId: '' }, fetchImpl),
    async origin => {
      const response = await post(origin, '/api/sale', {
        terminalId: 'v660p',
        poiId: v660pPoiId,
      });
      const body = await response.json();
      const payment = JSON.parse(calls[1].options.body);
      assert.equal(response.status, 200);
      assert.equal(calls.length, 2);
      assert.equal(
        calls[0].url,
        `${testConfig.baseUrl}/poscloud/nexo/status/713-363-458`,
      );
      assert.equal(
        calls[1].url,
        `${testConfig.baseUrl}/poscloud/nexo/v2/payment`,
      );
      assert.equal(payment.MessageHeader.POIID, v660pPoiId);
      assert.equal(calls[1].options.headers['x-site-entity-id'], v660pEntityId);
      assert.equal(body.request.POIID, v660pPoiId);
      assert.equal(body.body.PaymentResponse.Response.Result, 'SUCCESS');
    },
  );
});

test('blocks V660p sale when fresh status has no entity UUID', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statusResponse(
      'CONNECTED',
      testConfig.v660pSerialNumber,
      'POI V660P-TEST',
      null,
    );
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const response = await post(origin, '/api/sale', {
      terminalId: 'v660p',
      poiId: 'POI V660P-TEST',
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.match(body.error, /did not include an entity UUID/);
    assert.equal(calls.length, 1);
  });
});

test('requires a fresh connected status before sending the $1 sale', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statusResponse('DISCONNECTED');
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const response = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.match(body.error, /DISCONNECTED/);
    assert.equal(calls.length, 1);
  });
});

test('does not send a sale when VF_POI_ID is missing', async () => {
  let upstreamCalls = 0;
  const fetchImpl = async () => {
    upstreamCalls += 1;
    return statusResponse();
  };

  await withServer(
    createServer({ ...testConfig, poiId: '' }, fetchImpl),
    async origin => {
      const response = await post(origin, '/api/sale', {
        poiId: testConfig.poiId,
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /VF_POI_ID/);
      assert.equal(upstreamCalls, 0);
    },
  );
});

test('does not send a sale when VF_SITE_ENTITY_ID is missing', async () => {
  let upstreamCalls = 0;
  const fetchImpl = async () => {
    upstreamCalls += 1;
    return statusResponse();
  };

  await withServer(
    createServer({ ...testConfig, siteEntityId: '' }, fetchImpl),
    async origin => {
      const response = await post(origin, '/api/sale', {
        poiId: testConfig.poiId,
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /VF_SITE_ENTITY_ID/);
      assert.equal(upstreamCalls, 0);
    },
  );
});

test('does not send a sale when VF_POI_ID differs from the status POIID', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return statusResponse();
  };

  await withServer(
    createServer({ ...testConfig, poiId: '50006587' }, fetchImpl),
    async origin => {
      const response = await post(origin, '/api/sale', {
        poiId: '50006587',
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /exactly match the POIID/);
      assert.equal(calls.length, 1);
    },
  );
});

test('sends the documented sale body only after a connected preflight', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return statusResponse();
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
      SensitiveTestData: { primaryAccountNumber: '4111111111111111' },
    });
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const response = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    const body = await response.json();
    const payment = JSON.parse(calls[1].options.body);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      `${testConfig.baseUrl}/poscloud/nexo/v2/payment`,
    );
    assert.equal(payment.MessageHeader.POIID, testConfig.poiId);
    assert.equal(payment.MessageHeader.SaleID, 'VERIFONEPOS');
    assert.equal(
      calls[1].options.headers['x-site-entity-id'],
      testConfig.siteEntityId,
    );
    assert.equal(payment.MessageHeader.ServiceID.length > 0, true);
    assert.equal(
      payment.PaymentRequest.SaleData.SaleTransactionID.TransactionID.length >
        0,
      true,
    );
    assert.equal(
      Number.isNaN(
        Date.parse(payment.PaymentRequest.SaleData.SaleTransactionID.TimeStamp),
      ),
      false,
    );
    assert.equal(
      payment.PaymentRequest.PaymentTransaction.AmountsReq.RequestedAmount,
      '1.00',
    );
    assert.equal(
      body.request.SaleTransactionID.TransactionID,
      payment.PaymentRequest.SaleData.SaleTransactionID.TransactionID,
    );
    assert.equal(body.body.PaymentResponse.Response.Result, 'SUCCESS');
    assert.equal(
      body.body.SensitiveTestData.primaryAccountNumber,
      '[REDACTED]',
    );
    assert.equal(JSON.stringify(body).includes(testConfig.apiKey), false);

    const repeated = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(repeated.status, 409);
    assert.equal(calls.length, 2);
  });
});

test('checks transaction status against the original sale and redacts SaleToPOIData', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status/552-322-068')) return statusResponse();
    if (url.endsWith('/transactionstatus')) {
      return Response.json({
        TransactionStatusResponse: {
          RepeatedMessageResponse: {
            RepeatedResponseMessageBody: {
              PaymentResponse: {
                Response: { Result: 'SUCCESS' },
                SaleData: { SaleToPOIData: 'private-poi-reference' },
              },
            },
          },
        },
      });
    }
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
    });
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const unavailable = await post(origin, '/api/transaction-status');
    assert.equal(unavailable.status, 409);
    assert.equal(calls.length, 0);

    const saleResponse = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(saleResponse.status, 200);
    const saleRequest = JSON.parse(calls[1].options.body);

    const response = await post(origin, '/api/transaction-status');
    const body = await response.json();
    const transactionStatusRequest = JSON.parse(calls[2].options.body);
    assert.equal(response.status, 200);
    assert.equal(
      calls[2].url,
      `${testConfig.baseUrl}/poscloud/nexo/v2/transactionstatus`,
    );
    assert.equal(
      calls[2].options.headers['x-site-entity-id'],
      testConfig.siteEntityId,
    );
    assert.equal(
      transactionStatusRequest.MessageHeader.MessageCategory,
      'TRANSACTIONSTATUS',
    );
    assert.notEqual(
      transactionStatusRequest.MessageHeader.ServiceID,
      saleRequest.MessageHeader.ServiceID,
    );
    assert.deepEqual(
      transactionStatusRequest.TransactionStatusRequest.MessageReference,
      {
        MessageCategory: saleRequest.MessageHeader.MessageCategory,
        ServiceID: saleRequest.MessageHeader.ServiceID,
        SaleID: saleRequest.MessageHeader.SaleID,
        POIID: saleRequest.MessageHeader.POIID,
      },
    );
    assert.equal(body.transactionResult, 'SUCCESS');
    assert.equal(body.outcomeUnknown, false);
    assert.equal(body.canStartAnotherSale, true);
    assert.equal(
      body.body.TransactionStatusResponse.RepeatedMessageResponse
        .RepeatedResponseMessageBody.PaymentResponse.SaleData.SaleToPOIData,
      '[REDACTED]',
    );
  });
});

test('allows a new sale after transaction status confirms the previous payment failed', async () => {
  const calls = [];
  let paymentCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status/552-322-068')) return statusResponse();
    if (url.endsWith('/transactionstatus')) {
      return Response.json({
        TransactionStatusResponse: {
          RepeatedMessageResponse: {
            RepeatedResponseMessageBody: {
              PaymentResponse: { Response: { Result: 'FAILURE' } },
            },
          },
        },
      });
    }
    paymentCount += 1;
    return Response.json({
      PaymentResponse: {
        Response: { Result: paymentCount === 1 ? 'FAILURE' : 'SUCCESS' },
      },
    });
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const firstSale = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(firstSale.status, 200);

    const statusResponse = await post(origin, '/api/transaction-status');
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.transactionResult, 'FAILURE');
    assert.equal(statusBody.retryAllowed, true);
    assert.equal(statusBody.outcomeUnknown, false);

    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.equal(config.saleCompleted, false);

    const retry = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(retry.status, 200);
    assert.equal(paymentCount, 2);
  });
});

test('keeps sale locked when transaction status lookup fails', async () => {
  const calls = [];
  let paymentCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status/552-322-068')) return statusResponse();
    if (url.endsWith('/transactionstatus')) {
      return Response.json({ error: 'Unauthorised' }, { status: 401 });
    }
    paymentCount += 1;
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
    });
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const firstSale = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(firstSale.status, 200);

    const statusResponse = await post(origin, '/api/transaction-status');
    assert.equal(statusResponse.status, 502);

    const retry = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(retry.status, 409);
    assert.equal(paymentCount, 1);
    assert.equal(calls.length, 3);
  });
});

test('requires a confirmed successful result before re-arming another sale', async () => {
  const calls = [];
  let paymentCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status/552-322-068')) return statusResponse();
    if (url.endsWith('/transactionstatus')) {
      return Response.json({
        TransactionStatusResponse: {
          RepeatedMessageResponse: {
            RepeatedResponseMessageBody: {
              PaymentResponse: { Response: { Result: 'SUCCESS' } },
            },
          },
        },
      });
    }
    paymentCount += 1;
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
    });
  };

  await withServer(createServer(testConfig, fetchImpl), async origin => {
    const earlyRearm = await post(origin, '/api/new-sale');
    assert.equal(earlyRearm.status, 409);
    assert.equal(calls.length, 0);

    const firstSale = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(firstSale.status, 200);
    const status = await post(origin, '/api/transaction-status');
    assert.equal(status.status, 200);

    const rearm = await post(origin, '/api/new-sale');
    const rearmBody = await rearm.json();
    assert.equal(rearm.status, 200);
    assert.equal(rearmBody.ready, true);
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.equal(config.saleCompleted, false);
    assert.equal(config.transactionStatusAvailable, false);

    const secondSale = await post(origin, '/api/sale', {
      poiId: testConfig.poiId,
    });
    assert.equal(secondSale.status, 200);
    assert.equal(paymentCount, 2);
  });
});

test('preserves successful sale lock and re-arm eligibility across server restart', async () => {
  const sessionDirectory = mkdtempSync(path.join(tmpdir(), 'verifone-sale-'));
  const sessionPath = path.join(sessionDirectory, 'sale-session.json');
  const fetchImpl = async url => {
    if (url.endsWith('/status/552-322-068')) return statusResponse();
    if (url.endsWith('/transactionstatus')) {
      return Response.json({
        TransactionStatusResponse: {
          RepeatedMessageResponse: {
            RepeatedResponseMessageBody: {
              PaymentResponse: { Response: { Result: 'SUCCESS' } },
            },
          },
        },
      });
    }
    return Response.json({
      PaymentResponse: { Response: { Result: 'SUCCESS' } },
    });
  };

  try {
    await withServer(
      createServer(testConfig, fetchImpl, sessionPath),
      async origin => {
        const sale = await post(origin, '/api/sale', {
          poiId: testConfig.poiId,
        });
        assert.equal(sale.status, 200);
        await post(origin, '/api/transaction-status');
        const config = await (await fetch(`${origin}/api/config`)).json();
        assert.equal(config.canStartAnotherSale, true);
      },
    );

    await withServer(
      createServer(testConfig, fetchImpl, sessionPath),
      async origin => {
        const config = await (await fetch(`${origin}/api/config`)).json();
        assert.equal(config.saleCompleted, true);
        assert.equal(config.transactionStatusAvailable, true);
        assert.equal(config.canStartAnotherSale, true);

        const rearm = await post(origin, '/api/new-sale');
        assert.equal(rearm.status, 200);
        const rearmedConfig = await (
          await fetch(`${origin}/api/config`)
        ).json();
        assert.equal(rearmedConfig.saleCompleted, false);
        assert.equal(rearmedConfig.transactionStatusAvailable, false);
      },
    );
  } finally {
    rmSync(sessionDirectory, { recursive: true, force: true });
  }
});
