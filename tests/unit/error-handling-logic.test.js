import { describe, it, expect } from '@jest/globals';

describe('Error Handling Logic', () => {
  describe('Retry Logic Implementation', () => {
    const retryWithBackoff = async (fn, options = {}) => {
      const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        shouldRetry = () => true
      } = options;

      let lastError;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          
          if (attempt === maxRetries || !shouldRetry(error)) {
            throw error;
          }
          
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw lastError;
    };

    it('should succeed on first attempt', async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return 'success';
      };
      
      const result = await retryWithBackoff(mockFn);
      
      expect(result).toBe('success');
      expect(callCount).toBe(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        if (callCount === 1) throw new Error('First failure');
        if (callCount === 2) throw new Error('Second failure');
        return 'success';
      };
      
      const result = await retryWithBackoff(mockFn);
      
      expect(result).toBe('success');
      expect(callCount).toBe(3);
    });

    it('should throw after max retries', async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        throw new Error('Persistent failure');
      };
      
      await expect(retryWithBackoff(mockFn, { maxRetries: 2 }))
        .rejects.toThrow('Persistent failure');
      
      expect(callCount).toBe(3); // Initial + 2 retries
    });

    it('should respect shouldRetry function', async () => {
      let callCount = 0;
      let shouldRetryCalled = false;
      const mockFn = async () => {
        callCount++;
        throw new Error('Non-retryable');
      };
      const shouldRetry = (_error) => {
        shouldRetryCalled = true;
        return false;
      };
      
      await expect(retryWithBackoff(mockFn, { shouldRetry }))
        .rejects.toThrow('Non-retryable');
      
      expect(callCount).toBe(1);
      expect(shouldRetryCalled).toBe(true);
    });
  });

  describe('Error Classification', () => {
    const classifyError = (error) => {
      // Network errors
      if (error.code === 'ECONNRESET' || 
          error.code === 'ETIMEDOUT' || 
          error.code === 'ENOTFOUND') {
        return 'NETWORK_ERROR';
      }

      // HTTP errors
      if (error.response?.status) {
        const status = error.response.status;
        if (status >= 500) return 'SERVER_ERROR';
        if (status === 429) return 'RATE_LIMIT';
        if (status === 401 || status === 403) return 'AUTH_ERROR';
        if (status === 404) return 'NOT_FOUND';
        if (status >= 400) return 'CLIENT_ERROR';
      }

      // AWS SDK errors
      if (error.name === 'AccessDenied') return 'AWS_ACCESS_DENIED';
      if (error.name === 'NoSuchBucket') return 'AWS_NOT_FOUND';
      if (error.name === 'SlowDown') return 'AWS_RATE_LIMIT';
      if (error.name === 'ServiceUnavailable') return 'AWS_SERVICE_ERROR';

      return 'UNKNOWN_ERROR';
    };

    it('should classify network errors', () => {
      expect(classifyError({ code: 'ECONNRESET' })).toBe('NETWORK_ERROR');
      expect(classifyError({ code: 'ETIMEDOUT' })).toBe('NETWORK_ERROR');
      expect(classifyError({ code: 'ENOTFOUND' })).toBe('NETWORK_ERROR');
    });

    it('should classify HTTP errors', () => {
      expect(classifyError({ response: { status: 500 } })).toBe('SERVER_ERROR');
      expect(classifyError({ response: { status: 429 } })).toBe('RATE_LIMIT');
      expect(classifyError({ response: { status: 401 } })).toBe('AUTH_ERROR');
      expect(classifyError({ response: { status: 403 } })).toBe('AUTH_ERROR');
      expect(classifyError({ response: { status: 404 } })).toBe('NOT_FOUND');
      expect(classifyError({ response: { status: 400 } })).toBe('CLIENT_ERROR');
    });

    it('should classify AWS SDK errors', () => {
      expect(classifyError({ name: 'AccessDenied' })).toBe('AWS_ACCESS_DENIED');
      expect(classifyError({ name: 'NoSuchBucket' })).toBe('AWS_NOT_FOUND');
      expect(classifyError({ name: 'SlowDown' })).toBe('AWS_RATE_LIMIT');
      expect(classifyError({ name: 'ServiceUnavailable' })).toBe('AWS_SERVICE_ERROR');
    });

    it('should classify unknown errors', () => {
      expect(classifyError({ message: 'Unknown error' })).toBe('UNKNOWN_ERROR');
      expect(classifyError({})).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Retry Strategy', () => {
    const shouldRetryError = (error) => {
      const errorType = classifyError(error);
      
      const retryableErrors = [
        'NETWORK_ERROR',
        'SERVER_ERROR', 
        'RATE_LIMIT',
        'AWS_RATE_LIMIT',
        'AWS_SERVICE_ERROR'
      ];
      
      return retryableErrors.includes(errorType);
    };

    const classifyError = (error) => {
      if (error.code === 'ECONNRESET') return 'NETWORK_ERROR';
      if (error.response?.status >= 500) return 'SERVER_ERROR';
      if (error.response?.status === 429) return 'RATE_LIMIT';
      if (error.response?.status === 401) return 'AUTH_ERROR';
      if (error.name === 'SlowDown') return 'AWS_RATE_LIMIT';
      if (error.name === 'AccessDenied') return 'AWS_ACCESS_DENIED';
      return 'UNKNOWN_ERROR';
    };

    it('should retry network errors', () => {
      expect(shouldRetryError({ code: 'ECONNRESET' })).toBe(true);
    });

    it('should retry server errors', () => {
      expect(shouldRetryError({ response: { status: 500 } })).toBe(true);
    });

    it('should retry rate limit errors', () => {
      expect(shouldRetryError({ response: { status: 429 } })).toBe(true);
      expect(shouldRetryError({ name: 'SlowDown' })).toBe(true);
    });

    it('should not retry auth errors', () => {
      expect(shouldRetryError({ response: { status: 401 } })).toBe(false);
      expect(shouldRetryError({ name: 'AccessDenied' })).toBe(false);
    });
  });

  describe('Error Enhancement', () => {
    const enhanceError = (error, context = {}) => {
      const { operation, resource, details } = context;
      
      let enhancedMessage = error.message || 'Unknown error';
      
      if (operation) {
        enhancedMessage = `${operation} failed: ${enhancedMessage}`;
      }
      
      if (resource) {
        enhancedMessage = `${enhancedMessage} (Resource: ${resource})`;
      }
      
      if (details) {
        enhancedMessage = `${enhancedMessage} - ${details}`;
      }
      
      const enhancedError = new Error(enhancedMessage);
      enhancedError.originalError = error;
      enhancedError.context = context;
      
      return enhancedError;
    };

    it('should enhance error with operation context', () => {
      const originalError = new Error('Connection failed');
      const enhanced = enhanceError(originalError, { operation: 'Download' });
      
      expect(enhanced.message).toBe('Download failed: Connection failed');
      expect(enhanced.originalError).toBe(originalError);
    });

    it('should enhance error with resource context', () => {
      const originalError = new Error('Not found');
      const enhanced = enhanceError(originalError, { 
        operation: 'Upload',
        resource: 'test-bucket/test-key'
      });
      
      expect(enhanced.message).toBe('Upload failed: Not found (Resource: test-bucket/test-key)');
    });

    it('should enhance error with details', () => {
      const originalError = new Error('Access denied');
      const enhanced = enhanceError(originalError, { 
        operation: 'S3 Upload',
        resource: 'test-bucket',
        details: 'Check IAM permissions'
      });
      
      expect(enhanced.message).toBe('S3 Upload failed: Access denied (Resource: test-bucket) - Check IAM permissions');
    });
  });

  describe('Circuit Breaker Pattern', () => {
    const createCircuitBreaker = (options = {}) => {
      const {
        failureThreshold = 5,
        resetTimeout = 60000
      } = options;

      let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
      let failureCount = 0;
      let lastFailureTime = null;
      let successCount = 0;

      return {
        async execute(fn) {
          if (state === 'OPEN') {
            if (Date.now() - lastFailureTime > resetTimeout) {
              state = 'HALF_OPEN';
              successCount = 0;
            } else {
              throw new Error('Circuit breaker is OPEN');
            }
          }

          try {
            const result = await fn();
            
            if (state === 'HALF_OPEN') {
              successCount++;
              if (successCount >= 3) {
                state = 'CLOSED';
                failureCount = 0;
              }
            } else if (state === 'CLOSED') {
              failureCount = 0;
            }
            
            return result;
          } catch (error) {
            failureCount++;
            lastFailureTime = Date.now();
            
            if (failureCount >= failureThreshold) {
              state = 'OPEN';
            }
            
            throw error;
          }
        },
        
        getState: () => state,
        getFailureCount: () => failureCount
      };
    };

    it('should start in CLOSED state', () => {
      const breaker = createCircuitBreaker();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open after failure threshold', async () => {
      const breaker = createCircuitBreaker({ failureThreshold: 2 });
      const failingFn = async () => {
        throw new Error('Failure');
      };
      
      await expect(breaker.execute(failingFn)).rejects.toThrow('Failure');
      await expect(breaker.execute(failingFn)).rejects.toThrow('Failure');
      
      expect(breaker.getState()).toBe('OPEN');
      await expect(breaker.execute(failingFn)).rejects.toThrow('Circuit breaker is OPEN');
    });
  });
});
