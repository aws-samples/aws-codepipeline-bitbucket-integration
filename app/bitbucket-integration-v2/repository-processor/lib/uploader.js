import { logger } from '/opt/nodejs/lib/logger.js';
import { sharedUtil } from '/opt/nodejs/lib/util.js';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import crypto from 'crypto';

// Initialize S3 client
const s3Client = new S3Client({ 
    region: process.env.AWS_REGION || 'us-east-1',
    apiVersion: '2012-11-05'
});

export class S3Uploader {
    constructor() {}

    /**
     * Generate S3 key for repository archive
     * @param {string} projectName - Project name
     * @param {string} repoName - Repository name
     * @param {string} branch - Branch name
     * @param {string} correlationId - Correlation ID for uniqueness
     * @returns {string} S3 key
     */
    generateS3Key(projectName, repoName, branch, correlationId) {
        // Sanitize names for S3 key
        const sanitizedProject = this.sanitizeS3KeyComponent(projectName);
        const sanitizedRepo = this.sanitizeS3KeyComponent(repoName);
        const sanitizedBranch = this.sanitizeS3KeyComponent(branch);
        
        const s3Key = `repositories/${sanitizedProject}/${sanitizedRepo}/${sanitizedBranch}/source.zip`;
        
        logger.debug({ 
            projectName,
            repoName,
            branch,
            correlationId,
            s3Key
        }, 'Generated S3 key');
        
        return s3Key;
    }

    /**
     * Sanitize component for S3 key usage
     * @param {string} component - Component to sanitize
     * @returns {string} Sanitized component
     */
    sanitizeS3KeyComponent(component) {
        const lower = component.toLowerCase();
        return lower.replace(/[^a-zA-Z0-9\-_.]/g, (char) => {
            const hex = char.charCodeAt(0).toString(16).padStart(2, '0');
            return '~' + hex;
        });
    }

    /**
     * Calculate stream hash for integrity verification
     * @param {stream} stream - Stream to hash
     * @returns {Promise<string>} SHA256 hash
     */
    async calculateStreamHash(stream) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            
            stream.on('data', (chunk) => {
                hash.update(chunk);
            });
            
            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });
            
            stream.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Upload file to S3 with multipart upload and retry logic
     * @param {stream} fileStream - File stream to upload
     * @param {string} s3BucketName - S3 bucket name
     * @param {string} s3Key - S3 key
     * @param {object} metadata - Additional metadata
     * @param {object} options - Upload options
     * @returns {Promise<object>} Upload result
     */
    async uploadToS3(fileStream, s3BucketName, s3Key, metadata = {}, options = {}) {
        const {
            maxRetries = 3,
            partSize = 10 * 1024 * 1024, // 10MB parts
            queueSize = 4, // 4 concurrent parts
            shouldRetry = (error) => this.shouldRetryUpload(error)
        } = options;

        logger.info({ 
            bucket: s3BucketName,
            key: s3Key,
            partSize,
            queueSize,
            maxRetries
        }, 'Starting S3 upload');

        const uploadParams = {
            Bucket: s3BucketName,
            Key: s3Key,
            Body: fileStream,
            ContentType: 'application/zip',
            Metadata: {
                'upload-timestamp': new Date().toISOString(),
                'service': 'bitbucket-integration',
                'version': '2.0.0',
                ...metadata
            },
            ServerSideEncryption: 'AES256'
        };

        return await sharedUtil.retryWithBackoff(
            async () => {
                try {
                    const startTime = Date.now();
                    
                    // Use multipart upload for better performance and reliability
                    const parallelUploads3 = new Upload({
                        client: s3Client,
                        params: uploadParams,
                        partSize,
                        queueSize,
                        leavePartsOnError: false
                    });

                    // Track upload progress
                    parallelUploads3.on('httpUploadProgress', (progress) => {
                        const percentComplete = Math.round((progress.loaded / progress.total) * 100);
                        logger.debug({ 
                            key: s3Key,
                            loaded: progress.loaded,
                            total: progress.total,
                            percentComplete
                        }, 'Upload progress');
                    });

                    const result = await parallelUploads3.done();
                    const uploadTime = Date.now() - startTime;

                    logger.info({
                        bucket: s3BucketName,
                        key: s3Key,
                        location: result.Location,
                        etag: result.ETag,
                        uploadTime
                    }, 'S3 upload completed successfully');

                    return {
                        location: result.Location,
                        etag: result.ETag,
                        bucket: s3BucketName,
                        key: s3Key,
                        uploadTime,
                        size: uploadParams.Body.readableLength || null
                    };
                } catch (error) {
                    logger.error({
                        error: error.message,
                        bucket: s3BucketName,
                        key: s3Key,
                        errorCode: error.code,
                        statusCode: error.$metadata?.httpStatusCode
                    }, 'S3 upload failed');
                    
                    throw this.enhanceUploadError(error, s3BucketName, s3Key);
                }
            },
            {
                maxRetries,
                baseDelay: 1000,
                maxDelay: 30000,
                shouldRetry
            }
        );
    }

    /**
     * Check if object already exists in S3
     * @param {string} s3BucketName - S3 bucket name
     * @param {string} s3Key - S3 key
     * @returns {Promise<boolean>} True if object exists
     */
    async objectExists(s3BucketName, s3Key) {
        try {
            const command = new HeadObjectCommand({
                Bucket: s3BucketName,
                Key: s3Key
            });

            await s3Client.send(command);
            logger.debug({ bucket: s3BucketName, key: s3Key }, 'Object exists in S3');
            return true;
        } catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                logger.debug({ bucket: s3BucketName, key: s3Key }, 'Object does not exist in S3');
                return false;
            }
            
            logger.warn({ 
                error: error.message,
                bucket: s3BucketName,
                key: s3Key
            }, 'Error checking object existence');
            throw error;
        }
    }

    /**
     * Upload file with deduplication check
     * @param {stream} fileStream - File stream to upload
     * @param {string} s3BucketName - S3 bucket name
     * @param {string} s3Key - S3 key
     * @param {object} metadata - Additional metadata
     * @param {object} options - Upload options
     * @returns {Promise<object>} Upload result
     */
    async uploadWithDeduplication(fileStream, s3BucketName, s3Key, metadata = {}, options = {}) {
        const { skipIfExists = false } = options;

        if (skipIfExists) {
            const exists = await this.objectExists(s3BucketName, s3Key);
            if (exists) {
                logger.info({ 
                    bucket: s3BucketName,
                    key: s3Key
                }, 'Object already exists, skipping upload');
                
                return {
                    location: `https://${s3BucketName}.s3.amazonaws.com/${s3Key}`,
                    bucket: s3BucketName,
                    key: s3Key,
                    skipped: true
                };
            }
        }

        return await this.uploadToS3(fileStream, s3BucketName, s3Key, metadata, options);
    }

    /**
     * Determine if upload error should be retried
     * @param {Error} error - Upload error
     * @returns {boolean} True if should retry
     */
    shouldRetryUpload(error) {
        // Don't retry on access denied errors
        if (error.name === 'AccessDenied' || error.$metadata?.httpStatusCode === 403) {
            logger.warn({ errorName: error.name }, 'Access denied - not retrying');
            return false;
        }

        // Don't retry on invalid bucket errors
        if (error.name === 'NoSuchBucket' || error.$metadata?.httpStatusCode === 404) {
            logger.warn({ errorName: error.name }, 'Bucket not found - not retrying');
            return false;
        }

        // Don't retry on invalid request errors
        if (error.$metadata?.httpStatusCode === 400) {
            logger.warn({ statusCode: error.$metadata.httpStatusCode }, 'Bad request - not retrying');
            return false;
        }

        // Retry on throttling and server errors
        if (error.name === 'SlowDown' || 
            error.name === 'ServiceUnavailable' ||
            error.name === 'InternalError' ||
            error.$metadata?.httpStatusCode >= 500 ||
            error.$metadata?.httpStatusCode === 429) {
            logger.info({ 
                errorName: error.name,
                statusCode: error.$metadata?.httpStatusCode
            }, 'Retryable error detected');
            return true;
        }

        // Retry on network errors
        if (error.code === 'ECONNRESET' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ENOTFOUND') {
            logger.info({ errorCode: error.code }, 'Network error - retrying');
            return true;
        }

        logger.warn({ 
            errorName: error.name,
            errorCode: error.code,
            statusCode: error.$metadata?.httpStatusCode
        }, 'Non-retryable error detected');
        return false;
    }

    /**
     * Enhance upload error with additional context
     * @param {Error} error - Original error
     * @param {string} s3BucketName - S3 bucket name
     * @param {string} s3Key - S3 key
     * @returns {Error} Enhanced error
     */
    enhanceUploadError(error, s3BucketName, s3Key) {
        if (error.name === 'AccessDenied') {
            return new Error(`Access denied to S3 bucket ${s3BucketName}. Check IAM permissions.`);
        }
        
        if (error.name === 'NoSuchBucket') {
            return new Error(`S3 bucket ${s3BucketName} does not exist.`);
        }
        
        if (error.name === 'SlowDown') {
            return new Error(`S3 request rate exceeded for bucket ${s3BucketName}. Reduce request rate.`);
        }
        
        if (error.$metadata?.httpStatusCode === 413) {
            return new Error(`File too large for S3 upload to ${s3BucketName}/${s3Key}.`);
        }

        // Return original error with additional context
        error.message = `Failed to upload to S3 ${s3BucketName}/${s3Key}: ${error.message}`;
        return error;
    }

    /**
     * Generate presigned URL for uploaded object
     * @param {string} s3BucketName - S3 bucket name
     * @param {string} s3Key - S3 key
     * @param {number} expiresIn - URL expiration in seconds (default: 3600)
     * @returns {Promise<string>} Presigned URL
     */
    async generatePresignedUrl(s3BucketName, s3Key, expiresIn = 3600) {
        try {
            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
            
            const command = new GetObjectCommand({
                Bucket: s3BucketName,
                Key: s3Key
            });

            const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
            
            logger.debug({ 
                bucket: s3BucketName,
                key: s3Key,
                expiresIn
            }, 'Generated presigned URL');
            
            return presignedUrl;
        } catch (error) {
            logger.error({ 
                error: error.message,
                bucket: s3BucketName,
                key: s3Key
            }, 'Failed to generate presigned URL');
            throw error;
        }
    }
}

export const s3Uploader = new S3Uploader();
