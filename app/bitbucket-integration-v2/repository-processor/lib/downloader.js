import { logger } from '/opt/nodejs/lib/logger.js';
import { sharedUtil } from '/opt/nodejs/lib/util.js';
import axios from 'axios';

export class RepositoryDownloader {
    constructor() {}

    /**
     * Validate repository configuration
     * @param {object} repoConfig - Repository configuration
     * @returns {object} Validated configuration
     */
    validateRepoConfig(repoConfig) {
        const requiredParams = ['serverUrl', 'projectName', 'repoName', 'branch', 'token'];
        const missingParams = requiredParams.filter(key => !repoConfig[key]);

        if (missingParams.length > 0) {
            const errorMessage = `Missing required parameters: ${missingParams.join(', ')}`;
            logger.error({ missingParams }, errorMessage);
            throw new Error(errorMessage);
        }

        return repoConfig;
    }

    /**
     * Construct repository download URL
     * @param {string} serverUrl - Bitbucket server URL
     * @param {string} projectName - Project name
     * @param {string} repoName - Repository name
     * @param {string} branch - Branch name
     * @returns {string} Download URL
     */
    constructRepoDownloadUrl(serverUrl, projectName, repoName, branch) {
        const url = `${serverUrl}/rest/api/latest/projects/${projectName}/repos/${repoName}/archive?at=refs/heads/${branch}&format=zip`;
        logger.debug({ url, projectName, repoName, branch }, 'Constructed repository download URL');
        return url;
    }

    /**
     * Construct request options for axios
     * @param {string} url - Download URL
     * @param {string} token - Authentication token
     * @param {object} proxy - Proxy configuration
     * @returns {object} Request options
     */
    constructRequestOptions(url, token, proxy) {
        const { host, port, auth } = proxy || {};
        const proxyConfig = host ? { host, port, auth } : undefined;

        const options = {
            method: 'get',
            url,
            responseType: 'stream',
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'BitbucketIntegration/2.0.0'
            },
            timeout: 300000, // 5 minutes timeout
            maxContentLength: 1024 * 1024 * 1024, // 1GB max file size
            ...(proxyConfig ? { proxy: proxyConfig } : {})
        };

        logger.debug({ 
            url, 
            hasProxy: !!proxyConfig,
            timeout: options.timeout,
            maxContentLength: options.maxContentLength
        }, 'Constructed request options');

        return options;
    }

    /**
     * Download repository content as a zip file with retry logic
     * @param {object} repoConfig - Repository configuration
     * @param {object} proxy - Proxy configuration
     * @param {object} options - Download options
     * @returns {Promise<stream>} Repository zip file stream
     */
    async downloadRepository(repoConfig, proxy, options = {}) {
        const { 
            maxRetries = 3,
            shouldRetry = (error) => this.shouldRetryDownload(error)
        } = options;

        logger.info({ 
            project: repoConfig.projectName,
            repository: repoConfig.repoName,
            branch: repoConfig.branch,
            maxRetries
        }, 'Starting repository download');

        const validatedConfig = this.validateRepoConfig(repoConfig);
        const { serverUrl, projectName, repoName, branch, token } = validatedConfig;
        
        const url = this.constructRepoDownloadUrl(serverUrl, projectName, repoName, branch);
        const requestOptions = this.constructRequestOptions(url, token, proxy);

        return await sharedUtil.retryWithBackoff(
            async () => {
                try {
                    const startTime = Date.now();
                    const response = await axios.request(requestOptions);
                    const downloadTime = Date.now() - startTime;

                    logger.info({
                        project: projectName,
                        repository: repoName,
                        branch,
                        downloadTime,
                        statusCode: response.status,
                        contentLength: response.headers['content-length']
                    }, 'Repository downloaded successfully');

                    return response.data;
                } catch (error) {
                    logger.error({
                        error: error.message,
                        project: projectName,
                        repository: repoName,
                        branch,
                        statusCode: error.response?.status,
                        responseData: error.response?.data
                    }, 'Repository download failed');
                    
                    throw this.enhanceDownloadError(error, repoConfig);
                }
            },
            {
                maxRetries,
                baseDelay: 2000, // Start with 2 seconds
                maxDelay: 60000, // Max 1 minute
                shouldRetry
            }
        );
    }

    /**
     * Determine if download error should be retried
     * @param {Error} error - Download error
     * @returns {boolean} True if should retry
     */
    shouldRetryDownload(error) {
        // Don't retry on authentication errors
        if (error.response?.status === 401 || error.response?.status === 403) {
            logger.warn({ statusCode: error.response.status }, 'Authentication error - not retrying');
            return false;
        }

        // Don't retry on not found errors
        if (error.response?.status === 404) {
            logger.warn({ statusCode: error.response.status }, 'Resource not found - not retrying');
            return false;
        }

        // Don't retry on bad request errors
        if (error.response?.status === 400) {
            logger.warn({ statusCode: error.response.status }, 'Bad request - not retrying');
            return false;
        }

        // Retry on server errors and network errors
        if (error.code === 'ECONNRESET' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ENOTFOUND' ||
            (error.response?.status >= 500)) {
            logger.info({ 
                errorCode: error.code,
                statusCode: error.response?.status 
            }, 'Retryable error detected');
            return true;
        }

        logger.warn({ 
            errorCode: error.code,
            statusCode: error.response?.status 
        }, 'Non-retryable error detected');
        return false;
    }

    /**
     * Enhance download error with additional context
     * @param {Error} error - Original error
     * @param {object} repoConfig - Repository configuration
     * @returns {Error} Enhanced error
     */
    enhanceDownloadError(error, repoConfig) {
        const { projectName, repoName, branch } = repoConfig;
        
        if (error.response?.status === 401) {
            return new Error(`Authentication failed for ${projectName}/${repoName}:${branch}. Check token validity.`);
        }
        
        if (error.response?.status === 403) {
            return new Error(`Access denied to ${projectName}/${repoName}:${branch}. Check token permissions.`);
        }
        
        if (error.response?.status === 404) {
            return new Error(`Repository ${projectName}/${repoName}:${branch} not found. Check repository and branch names.`);
        }
        
        if (error.code === 'ETIMEDOUT') {
            return new Error(`Download timeout for ${projectName}/${repoName}:${branch}. Repository may be too large.`);
        }
        
        if (error.code === 'ENOTFOUND') {
            return new Error(`Cannot resolve Bitbucket server hostname. Check network connectivity.`);
        }

        // Return original error with additional context
        error.message = `Failed to download ${projectName}/${repoName}:${branch}: ${error.message}`;
        return error;
    }

    /**
     * Get repository size estimate (if available)
     * @param {object} repoConfig - Repository configuration
     * @param {object} proxy - Proxy configuration
     * @returns {Promise<number|null>} Repository size in bytes or null if unavailable
     */
    async getRepositorySize(repoConfig, proxy) {
        try {
            const { serverUrl, projectName, repoName, token } = repoConfig;
            const url = `${serverUrl}/rest/api/latest/projects/${projectName}/repos/${repoName}`;
            
            const requestOptions = {
                method: 'get',
                url,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'BitbucketIntegration/2.0.0'
                },
                timeout: 10000,
                ...(proxy ? { proxy } : {})
            };

            const response = await axios.request(requestOptions);
            const size = response.data.size;
            
            logger.debug({ 
                project: projectName,
                repository: repoName,
                size
            }, 'Retrieved repository size');
            
            return size || null;
        } catch (error) {
            logger.warn({ 
                error: error.message,
                project: repoConfig.projectName,
                repository: repoConfig.repoName
            }, 'Failed to get repository size');
            return null;
        }
    }
}

export const repositoryDownloader = new RepositoryDownloader();
