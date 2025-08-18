import { describe, it, expect } from '@jest/globals';

// Test basic utility functions without AWS dependencies
describe('Basic Utility Functions', () => {
  describe('String operations', () => {
    it('should convert to lowercase', () => {
      const input = { 'Content-Type': 'APPLICATION/JSON' };
      const result = Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key.toLowerCase(),
          typeof value === 'string' ? value.toLowerCase() : value
        ])
      );
      expect(result).toEqual({ 'content-type': 'application/json' });
    });

    it('should validate object structure', () => {
      const isPlainObject = (value) => (
        typeof value === 'object' &&
        value !== null &&
        Object.prototype.toString.call(value) === '[object Object]'
      );

      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(null)).toBe(false);
      expect(isPlainObject('string')).toBe(false);
    });
  });

  describe('S3 key generation', () => {
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
  });

  describe('URL construction', () => {
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

  describe('Validation functions', () => {
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
        .toThrow('Missing required parameters');
    });
  });

  describe('Error retry logic', () => {
    const shouldRetryDownload = (error) => {
      // Don't retry on authentication errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        return false;
      }

      // Don't retry on not found errors
      if (error.response?.status === 404) {
        return false;
      }

      // Retry on server errors and network errors
      if (error.code === 'ECONNRESET' || 
          error.code === 'ETIMEDOUT' || 
          error.code === 'ENOTFOUND' ||
          (error.response?.status >= 500)) {
        return true;
      }

      return false;
    };

    it('should not retry authentication errors', () => {
      const error = { response: { status: 401 } };
      expect(shouldRetryDownload(error)).toBe(false);
    });

    it('should not retry not found errors', () => {
      const error = { response: { status: 404 } };
      expect(shouldRetryDownload(error)).toBe(false);
    });

    it('should retry server errors', () => {
      const error = { response: { status: 500 } };
      expect(shouldRetryDownload(error)).toBe(true);
    });

    it('should retry network errors', () => {
      const error = { code: 'ECONNRESET' };
      expect(shouldRetryDownload(error)).toBe(true);
    });
  });
});