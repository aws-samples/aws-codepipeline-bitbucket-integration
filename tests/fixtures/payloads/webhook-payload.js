export const validWebhookPayload = {
  repository: {
    project: {
      key: 'TEST'
    },
    name: 'test-repo'
  },
  changes: [{
    ref: {
      type: 'BRANCH',
      displayId: 'main'
    },
    changeId: 'abc123'
  }]
};

export const invalidWebhookPayload = {
  repository: {
    name: 'test-repo'
  }
};

export const testEvent = {
  httpMethod: 'POST',
  path: '/webhook',
  headers: {
    'x-hub-signature': 'sha256=test-signature',
    'content-type': 'application/json'
  },
  body: JSON.stringify(validWebhookPayload)
};

export const testEventHeaders = {
  'x-event-key': 'diagnostics:ping'
};