import { describe, it, expect } from '@jest/globals';

describe('Business Logic Tests', () => {
  describe('S3 Key Generation Logic', () => {
    const sanitizeS3KeyComponent = (component) => {
      return component
        .replace(/[^a-zA-Z0-9\-_.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
    };

    const generateS3Key = (projectName, repoName, branch, _correlationId) => {
      const sanitizedProject = sanitizeS3KeyComponent(projectName);
      const sanitizedRepo = sanitizeS3KeyComponent(repoName);
      const sanitizedBranch = sanitizeS3KeyComponent(branch);
      
      return `repositories/${sanitizedProject}/${sanitizedRepo}/${sanitizedBranch}/source.zip`;
    };

    it('should generate valid S3 key', () => {
      const key = generateS3Key('TEST', 'test-repo', 'main', 'corr-123');
      expect(key).toBe('repositories/test/test-repo/main/source.zip');
    });

    it('should sanitize special characters', () => {
      const key = generateS3Key('TEST@#$', 'test repo!', 'feature/branch', 'corr-123');
      expect(key).toBe('repositories/test/test-repo/feature-branch/source.zip');
    });

    it('should handle edge cases', () => {
      expect(sanitizeS3KeyComponent('-test-component-')).toBe('test-component');
      expect(sanitizeS3KeyComponent('TestComponent')).toBe('testcomponent');
      expect(sanitizeS3KeyComponent('test@#$%component')).toBe('test-component');
    });
  });

  describe('URL Construction Logic', () => {
    const constructRepoDownloadUrl = (serverUrl, projectName, repoName, branch) => {
      return `${serverUrl}/rest/api/latest/projects/${projectName}/repos/${repoName}/archive?at=refs/heads/${branch}&format=zip`;
    };

    it('should construct correct download URL', () => {
      const url = constructRepoDownloadUrl(
        'https://bitbucket.example.com',
        'TEST',
        'test-repo',
        'main'
      );

      expect(url).toBe(
        'https://bitbucket.example.com/rest/api/latest/projects/TEST/repos/test-repo/archive?at=refs/heads/main&format=zip'
      );
    });
  });

  describe('Error Retry Logic', () => {
    const shouldRetryDownload = (error) => {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return false;
      }
      if (error.response?.status === 404 || error.response?.status === 400) {
        return false;
      }
      if (error.code === 'ECONNRESET' || 
          error.code === 'ETIMEDOUT' || 
          error.code === 'ENOTFOUND' ||
          (error.response?.status >= 500)) {
        return true;
      }
      return false;
    };

    const shouldRetryUpload = (error) => {
      if (error.name === 'AccessDenied' || error.$metadata?.httpStatusCode === 403) {
        return false;
      }
      if (error.name === 'NoSuchBucket' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      if (error.$metadata?.httpStatusCode === 400) {
        return false;
      }
      if (error.name === 'SlowDown' || 
          error.name === 'ServiceUnavailable' ||
          error.name === 'InternalError' ||
          error.$metadata?.httpStatusCode >= 500 ||
          error.$metadata?.httpStatusCode === 429) {
        return true;
      }
      if (error.code === 'ECONNRESET' || 
          error.code === 'ETIMEDOUT' || 
          error.code === 'ENOTFOUND') {
        return true;
      }
      return false;
    };

    describe('Download retry logic', () => {
      it('should not retry authentication errors', () => {
        expect(shouldRetryDownload({ response: { status: 401 } })).toBe(false);
        expect(shouldRetryDownload({ response: { status: 403 } })).toBe(false);
      });

      it('should not retry not found errors', () => {
        expect(shouldRetryDownload({ response: { status: 404 } })).toBe(false);
      });

      it('should retry server errors', () => {
        expect(shouldRetryDownload({ response: { status: 500 } })).toBe(true);
        expect(shouldRetryDownload({ response: { status: 502 } })).toBe(true);
      });

      it('should retry network errors', () => {
        expect(shouldRetryDownload({ code: 'ECONNRESET' })).toBe(true);
        expect(shouldRetryDownload({ code: 'ETIMEDOUT' })).toBe(true);
        expect(shouldRetryDownload({ code: 'ENOTFOUND' })).toBe(true);
      });
    });

    describe('Upload retry logic', () => {
      it('should not retry access denied errors', () => {
        expect(shouldRetryUpload({ name: 'AccessDenied' })).toBe(false);
        expect(shouldRetryUpload({ $metadata: { httpStatusCode: 403 } })).toBe(false);
      });

      it('should not retry bucket not found errors', () => {
        expect(shouldRetryUpload({ name: 'NoSuchBucket' })).toBe(false);
        expect(shouldRetryUpload({ $metadata: { httpStatusCode: 404 } })).toBe(false);
      });

      it('should retry throttling errors', () => {
        expect(shouldRetryUpload({ name: 'SlowDown' })).toBe(true);
        expect(shouldRetryUpload({ $metadata: { httpStatusCode: 429 } })).toBe(true);
      });

      it('should retry server errors', () => {
        expect(shouldRetryUpload({ $metadata: { httpStatusCode: 500 } })).toBe(true);
        expect(shouldRetryUpload({ name: 'ServiceUnavailable' })).toBe(true);
      });

      it('should retry network errors', () => {
        expect(shouldRetryUpload({ code: 'ECONNRESET' })).toBe(true);
        expect(shouldRetryUpload({ code: 'ETIMEDOUT' })).toBe(true);
      });
    });
  });

  describe('Configuration Validation Logic', () => {
    const validateRepoConfig = (repoConfig) => {
      const requiredParams = ['serverUrl', 'projectName', 'repoName', 'branch', 'token'];
      const missingParams = requiredParams.filter(key => !repoConfig[key]);

      if (missingParams.length > 0) {
        throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
      }

      return repoConfig;
    };

    it('should validate complete configuration', () => {
      const config = {
        serverUrl: 'https://bitbucket.example.com',
        projectName: 'TEST',
        repoName: 'test-repo',
        branch: 'main',
        token: 'test-token'
      };

      const result = validateRepoConfig(config);
      expect(result).toEqual(config);
    });

    it('should throw error for missing parameters', () => {
      const incompleteConfig = { serverUrl: 'https://test.com' };
      
      expect(() => validateRepoConfig(incompleteConfig))
        .toThrow('Missing required parameters: projectName, repoName, branch, token');
    });
  });

  describe('Error Enhancement Logic', () => {
    const enhanceDownloadError = (error, repoConfig) => {
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

      error.message = `Failed to download ${projectName}/${repoName}:${branch}: ${error.message}`;
      return error;
    };

    const enhanceUploadError = (error, s3BucketName, s3Key) => {
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

      error.message = `Failed to upload to S3 ${s3BucketName}/${s3Key}: ${error.message}`;
      return error;
    };

    it('should enhance download authentication errors', () => {
      const error = { response: { status: 401 } };
      const config = { projectName: 'TEST', repoName: 'test-repo', branch: 'main' };
      const enhanced = enhanceDownloadError(error, config);
      expect(enhanced.message).toContain('Authentication failed for TEST/test-repo:main');
    });

    it('should enhance download not found errors', () => {
      const error = { response: { status: 404 } };
      const config = { projectName: 'TEST', repoName: 'test-repo', branch: 'main' };
      const enhanced = enhanceDownloadError(error, config);
      expect(enhanced.message).toContain('Repository TEST/test-repo:main not found');
    });

    it('should enhance upload access denied errors', () => {
      const error = { name: 'AccessDenied' };
      const enhanced = enhanceUploadError(error, 'test-bucket', 'test-key');
      expect(enhanced.message).toContain('Access denied to S3 bucket test-bucket');
    });

    it('should enhance upload bucket not found errors', () => {
      const error = { name: 'NoSuchBucket' };
      const enhanced = enhanceUploadError(error, 'test-bucket', 'test-key');
      expect(enhanced.message).toContain('S3 bucket test-bucket does not exist');
    });
  });
});
