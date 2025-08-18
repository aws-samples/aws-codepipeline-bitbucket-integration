import { logger } from './logger.js';
import crypto from 'crypto';


export class SharedUtil {
    constructor() {}

    /**
     * Get AWS secrets using the AWS SDK directly
     * @param {string} secretName - Name of the secret to retrieve
     * @returns {Promise<string>} Secret value
     */
    async getSecret(secretName) {
        logger.info({ secretName }, 'Getting secret from AWS Secrets Manager');

        try {
            // Import AWS SDK dynamically to reduce cold start time
            const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
            
            // Create a client with the region from environment variable or default to us-east-1
            const client = new SecretsManagerClient({ 
                region: process.env.REGION || process.env.AWS_REGION || 'us-east-1' 
            });
            
            // Create the command to get the secret value
            const command = new GetSecretValueCommand({ 
                SecretId: secretName 
            });
            
            // Send the command to get the secret value
            const response = await client.send(command);
            
            logger.info({ secretName }, 'Successfully retrieved secret');
            
            // Parse the secret string if it's in JSON format
            try {
                const secretObj = JSON.parse(response.SecretString);
                // Extract the actual secret value from the JSON object
                // Look for common property names like 'secret', 'token', 'password', etc.
                const secretValue = secretObj.secret || secretObj.token || secretObj.password || secretObj.value;
                
                if (secretValue) {
                    logger.debug({ secretName }, 'Secret parsed from JSON successfully');
                    return secretValue;
                } else {
                    // If no recognized property is found, return the entire JSON string
                    logger.debug({ secretName }, 'No recognized property found in JSON secret, returning full JSON');
                    return response.SecretString;
                }
            } catch (parseError) {
                // If parsing fails, it's not a JSON string, so return the raw string
                logger.debug({ secretName }, 'Secret is not in JSON format, returning as-is');
                return response.SecretString;
            }
        } catch (error) {
            logger.error({ error: error.message, secretName }, 'Error getting secret');
            throw new Error(`Failed to get secret ${secretName}: ${error.message}`);
        }
    }

    /**
     * Get SSM parameter using the AWS SDK directly
     * @param {string} parameterName - Name of the parameter to retrieve
     * @returns {Promise<string>} Parameter value
     */
    async getSSMParameter(parameterName) {
        logger.info({ parameterName }, 'Getting parameter from SSM');

        try {
            // Import AWS SDK dynamically to reduce cold start time
            const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
            
            // Create a client with the region from environment variable or default to us-east-1
            const client = new SSMClient({ 
                region: process.env.REGION || process.env.AWS_REGION || 'us-east-1' 
            });
            
            // Create the command to get the parameter value
            const command = new GetParameterCommand({ 
                Name: parameterName,
                WithDecryption: true
            });
            
            // Send the command to get the parameter value
            const response = await client.send(command);
            
            logger.info({ parameterName }, 'Successfully retrieved parameter');
            return response.Parameter.Value;
        } catch (error) {
            logger.error({ error: error.message, parameterName }, 'Error getting parameter from SSM');
            throw new Error(`Failed to get parameter ${parameterName}: ${error.message}`);
        }
    }

    /**
     * Validate required input parameters
     * @param {string[]} requiredParams - Array of required parameter names
     * @param {object} inputParams - Object containing input parameters
     * @returns {object} Validated input parameters
     */
    validateInputParams(requiredParams, inputParams) {
        logger.info({ requiredParams }, 'Validating function input parameters');
        
        const missingParams = requiredParams.filter(key => 
            !inputParams[key] || inputParams[key] === null || inputParams[key] === undefined
        );

        if (missingParams.length > 0) {
            const errorMessage = `Missing required parameters: ${missingParams.join(', ')}`;
            logger.error({ missingParams }, errorMessage);
            throw new TypeError(errorMessage);
        }

        logger.info('Input parameters validation successful');
        return inputParams;
    }

    /**
     * Check if the input is a plain object
     * @param {*} value - Value to check
     * @returns {boolean} True if plain object
     */
    isPlainObject(value) {
        return (
            typeof value === 'object' &&
            value !== null &&
            Object.prototype.toString.call(value) === '[object Object]'
        );
    }

    /**
     * Convert object keys and values to lowercase
     * @param {object} obj - Object to convert
     * @returns {object} New object with lowercase keys and values
     */
    toLowerCase(obj) {
        logger.debug('Converting object to lowercase');
        
        if (!this.isPlainObject(obj)) {
            throw new TypeError('Input must be a plain object');
        }

        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => {
                const lowercaseKey = key.toLowerCase();
                const lowercaseValue = this.isPlainObject(value)
                    ? this.toLowerCase(value)
                    : typeof value === 'string' ? value.toLowerCase() : value;

                return [lowercaseKey, lowercaseValue];
            })
        );
    }

    /**
     * Check BitBucket Server Signature
     * @param {string} signingSecret - Signing secret for the BitBucket Server webhook
     * @param {string} signature - Signature applied by BitBucket to the message
     * @param {string} body - Message body
     * @returns {boolean} True if signature is valid
     */
    checkSignature(signingSecret, signature, body) {
        logger.debug('Checking webhook signature');

        if (!signingSecret || !signature || !body) {
            logger.warn('Missing required parameters for signature check');
            return false;
        }

        try {
            const hmac = crypto.createHmac('sha256', signingSecret);
            const hash = hmac.update(body).digest('hex');

            const [, signatureHash] = signature.split('=');
            const isValid = signatureHash === hash;

            logger.info({ isValid }, 'Signature validation completed');
            return isValid;
        } catch (error) {
            logger.error({ error: error.message }, 'Error checking signature');
            return false;
        }
    }

    /**
     * Generate a response for API Gateway
     * @param {string} statusCode - HTTP status code to return
     * @param {string} [detail] - Message detail to return (optional for 200 status)
     * @param {object} [additionalHeaders] - Additional headers to include
     * @returns {object} Formatted response object
     */
    responseToApiGw(statusCode, detail, additionalHeaders = {}) {
        const isSuccess = statusCode === '200';

        if (!statusCode) {
            throw new TypeError('responseToApiGw() expects at least argument statusCode');
        }

        if (!isSuccess && !detail) {
            throw new TypeError('responseToApiGw() expects at least arguments statusCode and detail for non-success responses');
        }

        const body = isSuccess
            ? detail
                ? { statusCode, message: detail }
                : 'ok'
            : { statusCode, fault: detail };

        const response = {
            statusCode: parseInt(statusCode),
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET',
                'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
                ...additionalHeaders
            },
        };

        logger.info({ statusCode, responseSize: response.body.length }, 'Returning API Gateway response');
        return response;
    }

    /**
     * Generate correlation ID for request tracing
     * @returns {string} UUID v4 correlation ID
     */
    generateCorrelationId() {
        return crypto.randomUUID();
    }

    /**
     * Sleep for specified milliseconds
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry function with exponential backoff
     * @param {Function} fn - Function to retry
     * @param {object} options - Retry options
     * @param {number} options.maxRetries - Maximum number of retries (default: 3)
     * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
     * @param {number} options.maxDelay - Maximum delay in milliseconds (default: 30000)
     * @param {Function} options.shouldRetry - Function to determine if error should be retried
     * @returns {Promise<*>} Result of the function
     */
    async retryWithBackoff(fn, options = {}) {
        const {
            maxRetries = 3,
            baseDelay = 1000,
            maxDelay = 30000,
            shouldRetry = () => true
        } = options;

        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info({ attempt, maxRetries }, 'Executing function with retry');
                return await fn();
            } catch (error) {
                lastError = error;
                logger.warn({ 
                    attempt, 
                    maxRetries, 
                    error: error.message 
                }, 'Function execution failed');

                if (attempt === maxRetries || !shouldRetry(error)) {
                    break;
                }

                // Calculate delay with jitter
                const jitter = Math.random() * 0.1 * baseDelay;
                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + jitter, maxDelay);
                
                logger.info({ delay, attempt }, 'Waiting before retry');
                await this.sleep(delay);
            }
        }

        logger.error({ error: lastError.message, maxRetries }, 'All retry attempts failed');
        throw lastError;
    }
}

export const sharedUtil = new SharedUtil();
