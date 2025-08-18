import { logger } from '/opt/nodejs/lib/logger.js';
import { sharedUtil } from '/opt/nodejs/lib/util.js';

export class WebhookValidator {
    constructor() {}

    /**
     * Check if the event is a Bitbucket test event
     * @param {object} headers - Normalized headers from the request
     * @returns {boolean} True if it's a test event
     */
    isTestEvent(headers) {
        logger.info('Checking if event is a test');
        return 'x-event-key' in headers && headers['x-event-key'] === 'diagnostics:ping';
    }

    /**
     * Validate if the event is a branch event
     * @param {object} eventBody - Parsed webhook payload
     * @returns {boolean} True if it's a valid branch event
     */
    isBranchEvent(eventBody) {
        logger.info('Validating if it is a branch event');
        
        try {
            // Check if changes array exists and has at least one element
            if (!eventBody.changes || !Array.isArray(eventBody.changes) || eventBody.changes.length === 0) {
                logger.warn('No changes found in webhook payload');
                return false;
            }

            // Check if the first change is a branch event
            const firstChange = eventBody.changes[0];
            if (!firstChange.ref || firstChange.ref.type !== 'BRANCH') {
                logger.warn({ refType: firstChange.ref?.type }, 'Event is not a branch event');
                return false;
            }

            logger.info({ branch: firstChange.ref.displayId }, 'Valid branch event detected');
            return true;
        } catch (error) {
            logger.error({ error: error.message }, 'Error validating branch event');
            return false;
        }
    }

    /**
     * Validate webhook payload structure
     * @param {object} eventBody - Parsed webhook payload
     * @param {string} normalizedProjectKey - Normalized project key (lowercase)
     * @param {string} normalizedRepoName - Normalized repository name (lowercase)
     * @returns {object} Validated payload data
     */
    validateWebhookPayload(eventBody, normalizedProjectKey = null, normalizedRepoName = null) {
        logger.info('Validating webhook payload structure');

        try {
            // Validate repository information
            if (!eventBody.repository) {
                throw new Error('Missing repository information in webhook payload');
            }

            if (!eventBody.repository.project || !eventBody.repository.project.key) {
                throw new Error('Missing project key in webhook payload');
            }

            if (!eventBody.repository.name) {
                throw new Error('Missing repository name in webhook payload');
            }

            // Validate changes information
            if (!eventBody.changes || !Array.isArray(eventBody.changes) || eventBody.changes.length === 0) {
                throw new Error('Missing or invalid changes in webhook payload');
            }

            const firstChange = eventBody.changes[0];
            if (!firstChange.ref || !firstChange.ref.displayId) {
                throw new Error('Missing branch information in webhook payload');
            }

            // Use normalized names if provided, otherwise normalize from original
            const projectKey = normalizedProjectKey || eventBody.repository.project.key.toLowerCase();
            const repoName = normalizedRepoName || eventBody.repository.name.toLowerCase();

            const validatedPayload = {
                repository: {
                    project: {
                        key: projectKey
                    },
                    name: repoName
                },
                branch: firstChange.ref.displayId.toLowerCase(),
                changeId: firstChange.changeId || null,
                timestamp: new Date().toISOString(),
                correlationId: sharedUtil.generateCorrelationId()
            };

            logger.info({ 
                project: validatedPayload.repository.project.key,
                repository: validatedPayload.repository.name,
                branch: validatedPayload.branch,
                correlationId: validatedPayload.correlationId
            }, 'Webhook payload validation successful');

            return validatedPayload;
        } catch (error) {
            logger.error({ error: error.message }, 'Webhook payload validation failed');
            throw error;
        }
    }

    /**
     * Validate webhook signature
     * @param {string} bitbucketSecret - Secret for signature validation
     * @param {object} headers - Request headers
     * @param {string} body - Raw request body
     * @returns {boolean} True if signature is valid
     */
    async validateSignature(bitbucketSecret, headers, body) {
        logger.info('Validating webhook signature');

        try {
            const signature = headers['x-hub-signature'];
            if (!signature) {
                logger.warn('Missing x-hub-signature header');
                return false;
            }

            const isValid = sharedUtil.checkSignature(bitbucketSecret, signature, body);
            
            if (!isValid) {
                logger.warn('Invalid webhook signature');
            } else {
                logger.info('Webhook signature validation successful');
            }

            return isValid;
        } catch (error) {
            logger.error({ error: error.message }, 'Error validating webhook signature');
            return false;
        }
    }

    /**
     * Extract repository information from payload for secret lookup
     * @param {object} eventBody - Parsed webhook payload
     * @returns {object} Repository info
     */
    extractRepositoryInfo(eventBody) {
        try {
            if (!eventBody.repository?.project?.key || !eventBody.repository?.name) {
                throw new Error('Missing repository information in payload');
            }
            
            return {
                projectKey: eventBody.repository.project.key,
                repoName: eventBody.repository.name
            };
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to extract repository info');
            throw new Error('Invalid repository information in payload');
        }
    }

    /**
     * Extract proxy configuration from environment
     * @returns {object|undefined} Proxy configuration or undefined
     */
    getProxyConfig() {
        const { WEBPROXY_HOST, WEBPROXY_PORT } = process.env;
        
        if (WEBPROXY_HOST && WEBPROXY_PORT) {
            logger.info({ host: WEBPROXY_HOST, port: WEBPROXY_PORT }, 'Using proxy configuration');
            return {
                host: WEBPROXY_HOST,
                port: WEBPROXY_PORT,
            };
        }

        logger.debug('No proxy configuration found');
        return undefined;
    }
}

export const webhookValidator = new WebhookValidator();

// Custom error classes
export class InvalidEventError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidEventError';
    }
}

export class InvalidSignatureError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidSignatureError';
    }
}

export class InvalidPayloadError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidPayloadError';
    }
}
