const statusButton = document.querySelector('#check-status');
const prepareSaleButton = document.querySelector('#prepare-sale');
const confirmSaleButton = document.querySelector('#confirm-sale');
const saleDialog = document.querySelector('#sale-dialog');
const terminalSelect = document.querySelector('#terminal-select');
const terminalName = document.querySelector('#terminal-name');
const serialLabel = document.querySelector('#serial-number');
const transactionStatusButton = document.querySelector(
  '#check-transaction-status',
);
const startAnotherSaleButton = document.querySelector('#start-another-sale');
const stateMark = document.querySelector('#state-mark');
const statusMessage = document.querySelector('#status-message');
const gateNote = document.querySelector('#gate-note');
const responseKind = document.querySelector('#response-kind');
const responseBody = document.querySelector('#response-body');

let terminal = null;
let configuredPoiId = '';
let siteEntityIdConfigured = false;
let terminals = [];
let selectedTerminalId = 'p630';
let transactionStatusAvailable = false;
let busy = false;
let outcomeUnknown = false;
let saleCompleted = false;
let canStartAnotherSale = false;

function saleIsReady() {
  if (outcomeUnknown || saleCompleted || terminal?.POIState !== 'CONNECTED') {
    return false;
  }
  if (selectedTerminalId === 'p630') {
    return Boolean(
      configuredPoiId &&
      siteEntityIdConfigured &&
      terminal.POIID === configuredPoiId,
    );
  }
  return Boolean(
    selectedTerminalId === 'v660p' && terminal.POIID && terminal.entityUID,
  );
}

function setBusy(value) {
  busy = value;
  statusButton.disabled = value;
  terminalSelect.disabled = value;
  transactionStatusButton.disabled = value || !transactionStatusAvailable;
  startAnotherSaleButton.disabled = value || !canStartAnotherSale;
  prepareSaleButton.disabled = value || !saleIsReady();
  confirmSaleButton.disabled = value;
}

function showResponse(kind, value) {
  responseKind.textContent = kind;
  responseBody.textContent = JSON.stringify(value, null, 2);
}

function setStatus(message, state = 'unknown') {
  statusMessage.textContent = message;
  stateMark.dataset.state = state.toLowerCase();
}

async function postJson(path, data = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  return { response, result };
}

async function checkStatus() {
  if (busy) return;
  terminal = null;
  prepareSaleButton.disabled = true;
  setBusy(true);
  setStatus('Checking POS Cloud...', 'checking');
  gateNote.textContent =
    'Sale remains locked until the selected terminal reports CONNECTED.';
  responseKind.textContent = 'GET status';

  try {
    const { response, result } = await postJson('/api/status', {
      terminalId: selectedTerminalId,
    });
    showResponse(
      response.ok
        ? 'GET status · received'
        : `GET status · HTTP ${response.status}`,
      result,
    );

    if (!response.ok || !result.terminal) {
      setStatus(result.error ?? 'Status check failed.', 'error');
      return;
    }

    terminal = result.terminal;
    const state = terminal.POIState ?? 'UNKNOWN';
    const statusPoiId = terminal.POIID ?? 'POIID unavailable';
    setStatus(`${state} · Status POIID ${statusPoiId}`, state);
    if (selectedTerminalId === 'v660p') {
      if (state !== 'CONNECTED') {
        gateNote.textContent =
          'No sale will be sent until the V660p reports CONNECTED.';
      } else if (!terminal.POIID || !terminal.entityUID) {
        gateNote.textContent =
          'The V660p status response must include both POIID and entityUID before a sale can be reviewed.';
      } else {
        gateNote.textContent =
          'V660p is connected. Review sale uses its status POIID and entity UUID; verify the configured sandbox provider before sending.';
      }
    } else if (state === 'CONNECTED' && !configuredPoiId) {
      gateNote.textContent =
        'Set VF_POI_ID to the exact POIID returned here, including its prefix, then restart the app.';
    } else if (state === 'CONNECTED' && statusPoiId !== configuredPoiId) {
      gateNote.textContent =
        'VF_POI_ID does not match the status POIID. No sale will be sent until they match exactly.';
    } else if (state === 'CONNECTED' && !siteEntityIdConfigured) {
      gateNote.textContent =
        'Set VF_SITE_ENTITY_ID to this account’s entity UUID from the status response, then restart the app.';
    } else if (state === 'CONNECTED') {
      gateNote.textContent =
        'POIID and site entity are configured. Review sale will recheck the terminal before sending.';
    } else {
      gateNote.textContent =
        'No payment will be sent until the terminal reports CONNECTED.';
    }
  } catch {
    setStatus('Could not reach the local console server.', 'error');
    showResponse('Local error', {
      error: 'Check that the server is running and try again.',
    });
  } finally {
    setBusy(false);
  }
}

async function sendSale() {
  if (busy || !saleIsReady()) return;

  saleDialog.close();
  setBusy(true);
  setStatus('Waiting for terminal response...', 'checking');
  gateNote.textContent =
    'Keep the selected terminal available for card presentation. Do not retry if the request times out.';
  responseKind.textContent = 'POST sale';

  try {
    const { response, result } = await postJson('/api/sale', {
      terminalId: selectedTerminalId,
      poiId: selectedTerminalId === 'p630' ? configuredPoiId : terminal.POIID,
    });
    transactionStatusAvailable = result.transactionStatusAvailable === true;
    showResponse(
      response.ok
        ? 'POST sale · received'
        : `POST sale · HTTP ${response.status}`,
      result,
    );

    if (result.outcomeUnknown) {
      outcomeUnknown = true;
      setStatus(
        'Outcome unknown. Verify the transaction before any retry.',
        'error',
      );
      gateNote.textContent =
        'Do not restart the server or resend until you have verified whether the payment completed.';
    } else if (response.ok) {
      saleCompleted = true;
      const paymentResult =
        result.body?.PaymentResponse?.Response?.Result ?? 'Response received';
      setStatus(`Sale response: ${paymentResult}`, paymentResult);
      gateNote.textContent =
        'Verify this transaction in the configured provider sandbox before continuing.';
    } else {
      setStatus(result.error ?? 'Sale request failed.', 'error');
      gateNote.textContent =
        'Read the response before deciding what to do next. Payment requests are not retried.';
    }
  } catch {
    outcomeUnknown = true;
    transactionStatusAvailable = true;
    setStatus('No response. Payment outcome may be unknown.', 'error');
    gateNote.textContent =
      'Do not retry. Verify the transaction in POS Cloud/Braintree before restarting the app.';
    showResponse('Local error', {
      error:
        'The connection ended while waiting. Treat the outcome as unknown.',
    });
  } finally {
    setBusy(false);
  }
}

async function checkTransactionStatus() {
  if (busy || !transactionStatusAvailable) return;

  setBusy(true);
  setStatus('Checking transaction status...', 'checking');
  responseKind.textContent = 'POST transaction status';

  try {
    const { response, result } = await postJson('/api/transaction-status');
    showResponse(
      response.ok
        ? 'POST transaction status · received'
        : `POST transaction status · HTTP ${response.status}`,
      result,
    );

    if (!response.ok) {
      setStatus(result.error ?? 'Transaction status check failed.', 'error');
      gateNote.textContent = result.outcomeUnknown
        ? 'The payment outcome is still unknown. Do not retry the sale; resolve this transaction first.'
        : 'The status request failed. Review the response before taking another action.';
      return;
    }

    transactionStatusAvailable = result.transactionStatusAvailable === true;
    outcomeUnknown = result.outcomeUnknown === true;
    canStartAnotherSale = result.canStartAnotherSale === true;
    if (result.retryAllowed === true && !outcomeUnknown) {
      saleCompleted = false;
    } else if (
      ['SUCCESS', 'PARTIAL'].includes(result.transactionResult) &&
      !outcomeUnknown
    ) {
      saleCompleted = true;
    }
    const transactionResult =
      result.transactionResult ?? 'No final result reported';
    setStatus(
      `Transaction status: ${transactionResult}`,
      transactionResult === 'SUCCESS' ? 'connected' : 'error',
    );
    gateNote.textContent = outcomeUnknown
      ? 'The transaction may still be in progress. Do not retry; check status again or reconcile with Verifone.'
      : result.retryAllowed === true
        ? 'POS Cloud confirms the previous attempt failed. With receipt paper loaded, you can review a new sandbox sale.'
        : 'Review the response and verify the transaction with your provider. A new sale remains locked unless POS Cloud confirms FAILURE.';
  } catch {
    setStatus('Could not reach transaction status.', 'error');
    gateNote.textContent =
      'The original sale outcome may still be unknown. Do not retry until you verify it.';
  } finally {
    setBusy(false);
  }
}

async function startAnotherSale() {
  if (busy || !canStartAnotherSale) return;

  setBusy(true);
  try {
    const { response, result } = await postJson('/api/new-sale');
    showResponse(
      response.ok ? 'New sale · ready' : `New sale · HTTP ${response.status}`,
      result,
    );
    if (!response.ok) {
      setStatus(result.error ?? 'Could not start another sale.', 'error');
      return;
    }

    canStartAnotherSale = false;
    transactionStatusAvailable = false;
    saleCompleted = false;
    outcomeUnknown = false;
    terminal = null;
    setStatus('New sale ready · check terminal status');
    gateNote.textContent =
      'Check the selected terminal again. Review sale will require a connected status and manual confirmation.';
  } catch {
    setStatus('Could not start another sale.', 'error');
  } finally {
    setBusy(false);
  }
}

statusButton.addEventListener('click', checkStatus);
transactionStatusButton.addEventListener('click', checkTransactionStatus);
startAnotherSaleButton.addEventListener('click', startAnotherSale);
terminalSelect.addEventListener('change', () => {
  selectedTerminalId = terminalSelect.value;
  terminal = null;
  const selectedTerminal = terminals.find(
    configuredTerminal => configuredTerminal.id === selectedTerminalId,
  );
  terminalName.textContent = selectedTerminal?.name ?? 'Unknown terminal';
  serialLabel.textContent = selectedTerminal?.serialNumber ?? '';
  setStatus('Not checked yet');
  gateNote.textContent =
    selectedTerminalId === 'v660p'
      ? 'V660p sales use the POIID and entity UUID returned by its fresh status check.'
      : 'Check the P630 first. A sale also requires the exact POIID and this merchant’s entity UUID.';
  responseKind.textContent = 'Waiting';
  responseBody.textContent = 'No request sent.';
  setBusy(false);
});
prepareSaleButton.addEventListener('click', () => {
  if (!busy && saleIsReady()) {
    saleDialog.showModal();
  }
});
confirmSaleButton.addEventListener('click', sendSale);

fetch('/api/config')
  .then(response => response.json())
  .then(config => {
    configuredPoiId = config.poiId ?? '';
    siteEntityIdConfigured = config.siteEntityIdConfigured === true;
    transactionStatusAvailable = config.transactionStatusAvailable === true;
    outcomeUnknown = config.outcomeUnknown === true;
    saleCompleted = config.saleCompleted === true;
    canStartAnotherSale = config.canStartAnotherSale === true;
    terminals = config.terminals ?? [
      { id: 'p630', name: 'P630', serialNumber: config.serialNumber },
    ];
    terminalSelect.replaceChildren(
      ...terminals.map(configuredTerminal => {
        const option = document.createElement('option');
        option.value = configuredTerminal.id;
        option.textContent = configuredTerminal.name;
        return option;
      }),
    );
    terminalSelect.value = selectedTerminalId;
    const selectedTerminal = terminals.find(
      configuredTerminal => configuredTerminal.id === selectedTerminalId,
    );
    terminalName.textContent = selectedTerminal?.name ?? 'Unknown terminal';
    serialLabel.textContent = selectedTerminal?.serialNumber ?? '';
    setBusy(false);
  })
  .catch(() => {
    serialLabel.textContent = 'server unavailable';
  });
