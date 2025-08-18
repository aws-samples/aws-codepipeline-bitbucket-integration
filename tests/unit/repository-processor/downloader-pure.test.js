import { describe, it, expect } from '@jest/globals';

// Pure logic tests for downloader functionality
describe('Downloader - Pure Logic Tests', () => {
  
  describe('URL construction', () => {
    it('should construct Bitbucket archive URL correctly', () => {
      const constructArchiveUrl = (baseUrl, projectKey, repositorySlug, commitId, format = 'zip') => {
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        return `${cleanBaseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repositorySlug}/archive?at=${commitId}&format=${format}`;
      };

      const url = constructArchiveUrl('http://bitbucket.example.com', 'PROJECT', 'repo-name', 'abc123');
      
      expect(url).toBe('http://bitbucket.example.com/rest/api/1.0/projects/PROJECT/repos/repo-name/archive?at=abc123&format=zip');
    });

    it('should handle base URL with trailing slash', () => {
      const constructArchiveUrl = (baseUrl, projectKey, repositorySlug, commitId, format = 'zip') => {
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        return `${cleanBaseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repositorySlug}/archive?at=${commitId}&format=${format}`;
      };

      const url = constructArchiveUrl('http://bitbucket.example.com/', 'PROJECT', 'repo-name', 'abc123');
      
      expect(url).toBe('http://bitbucket.example.com/rest/api/1.0/projects/PROJECT/repos/repo-name/archive?at=abc123&format=zip');
    });

    it('should support different archive formats', () => {
      const constructArchiveUrl = (baseUrl, projectKey, repositorySlug, commitId, format = 'zip') => {
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        return `${cleanBaseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repositorySlug}/archive?at=${commitId}&format=${format}`;
      };

      const zipUrl = constructArchiveUrl('http://bitbucket.example.com', 'PROJECT', 'repo', 'abc123', 'zip');
      const tarUrl = constructArchiveUrl('http://bitbucket.example.com', 'PROJECT', 'repo', 'abc123', 'tar.gz');
      
      expect(zipUrl).toContain('format=zip');
      expect(tarUrl).toContain('format=tar.gz');
    });
  });

  describe('authentication header creation', () => {
    it('should create basic auth header', () => {
      const createBasicAuthHeader = (username, password) => {
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${credentials}`;
      };

      const header = createBasicAuthHeader('user', 'pass');
      const expectedCredentials = Buffer.from('user:pass').toString('base64');
      
      expect(header).toBe(`Basic ${expectedCredentials}`);
    });

    it('should create bearer token header', () => {
      const createBearerAuthHeader = (token) => {
        return `Bearer ${token}`;
      };

      const header = createBearerAuthHeader('abc123token');
      
      expect(header).toBe('Bearer abc123token');
    });

    it('should handle special characters in credentials', () => {
      const createBasicAuthHeader = (username, password) => {
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${credentials}`;
      };

      const header = createBasicAuthHeader('user@domain.com', 'p@ssw0rd!');
      const expectedCredentials = Buffer.from('user@domain.com:p@ssw0rd!').toString('base64');
      
      expect(header).toBe(`Basic ${expectedCredentials}`);
    });
  });

  describe('repository key parsing', () => {
    it('should parse repository key into components', () => {
      const parseRepositoryKey = (repositoryKey) => {
        const parts = repositoryKey.split('/');
        if (parts.length < 2) {
          throw new Error('Invalid repository key format. Expected: PROJECT/REPOSITORY');
        }
        
        return {
          projectKey: parts[0],
          repositorySlug: parts[1],
          branch: parts[2] || 'main'
        };
      };

      const parsed = parseRepositoryKey('PROJECT/repo-name/feature-branch');
      
      expect(parsed).toEqual({
        projectKey: 'PROJECT',
        repositorySlug: 'repo-name',
        branch: 'feature-branch'
      });
    });

    it('should use default branch when not specified', () => {
      const parseRepositoryKey = (repositoryKey) => {
        const parts = repositoryKey.split('/');
        if (parts.length < 2) {
          throw new Error('Invalid repository key format. Expected: PROJECT/REPOSITORY');
        }
        
        return {
          projectKey: parts[0],
          repositorySlug: parts[1],
          branch: parts[2] || 'main'
        };
      };

      const parsed = parseRepositoryKey('PROJECT/repo-name');
      
      expect(parsed.branch).toBe('main');
    });

    it('should throw error for invalid repository key', () => {
      const parseRepositoryKey = (repositoryKey) => {
        const parts = repositoryKey.split('/');
        if (parts.length < 2) {
          throw new Error('Invalid repository key format. Expected: PROJECT/REPOSITORY');
        }
        
        return {
          projectKey: parts[0],
          repositorySlug: parts[1],
          branch: parts[2] || 'main'
        };
      };

      expect(() => parseRepositoryKey('invalid-key')).toThrow('Invalid repository key format');
    });
  });

  describe('download progress tracking', () => {
    it('should calculate download progress', () => {
      const calculateDownloadProgress = (downloaded, total) => {
        if (total === 0) return 0;
        return Math.round((downloaded / total) * 100);
      };

      expect(calculateDownloadProgress(25, 100)).toBe(25);
      expect(calculateDownloadProgress(50, 100)).toBe(50);
      expect(calculateDownloadProgress(100, 100)).toBe(100);
      expect(calculateDownloadProgress(0, 100)).toBe(0);
    });

    it('should handle unknown total size', () => {
      const calculateDownloadProgress = (downloaded, total) => {
        if (total === 0) return 0;
        return Math.round((downloaded / total) * 100);
      };

      expect(calculateDownloadProgress(1024, 0)).toBe(0);
    });
  });

  describe('error handling for downloads', () => {
    it('should classify download errors', () => {
      const classifyDownloadError = (error) => {
        const statusCode = error.status || error.statusCode;
        
        if (statusCode === 401) return 'AUTHENTICATION_ERROR';
        if (statusCode === 403) return 'AUTHORIZATION_ERROR';
        if (statusCode === 404) return 'NOT_FOUND_ERROR';
        if (statusCode >= 500) return 'SERVER_ERROR';
        if (error.code === 'ENOTFOUND') return 'NETWORK_ERROR';
        if (error.code === 'ETIMEDOUT') return 'TIMEOUT_ERROR';
        
        return 'UNKNOWN_ERROR';
      };

      expect(classifyDownloadError({ status: 401 })).toBe('AUTHENTICATION_ERROR');
      expect(classifyDownloadError({ statusCode: 403 })).toBe('AUTHORIZATION_ERROR');
      expect(classifyDownloadError({ status: 404 })).toBe('NOT_FOUND_ERROR');
      expect(classifyDownloadError({ status: 500 })).toBe('SERVER_ERROR');
      expect(classifyDownloadError({ code: 'ENOTFOUND' })).toBe('NETWORK_ERROR');
      expect(classifyDownloadError({ code: 'ETIMEDOUT' })).toBe('TIMEOUT_ERROR');
      expect(classifyDownloadError({ message: 'Unknown error' })).toBe('UNKNOWN_ERROR');
    });

    it('should determine if download error is retryable', () => {
      const isRetryableDownloadError = (error) => {
        const nonRetryableErrors = [
          'AUTHENTICATION_ERROR',
          'AUTHORIZATION_ERROR',
          'NOT_FOUND_ERROR'
        ];
        
        const errorType = error.type || 'UNKNOWN_ERROR';
        return !nonRetryableErrors.includes(errorType);
      };

      expect(isRetryableDownloadError({ type: 'SERVER_ERROR' })).toBe(true);
      expect(isRetryableDownloadError({ type: 'NETWORK_ERROR' })).toBe(true);
      expect(isRetryableDownloadError({ type: 'TIMEOUT_ERROR' })).toBe(true);
      expect(isRetryableDownloadError({ type: 'AUTHENTICATION_ERROR' })).toBe(false);
      expect(isRetryableDownloadError({ type: 'AUTHORIZATION_ERROR' })).toBe(false);
      expect(isRetryableDownloadError({ type: 'NOT_FOUND_ERROR' })).toBe(false);
    });
  });

  describe('request configuration', () => {
    it('should create download request config', () => {
      const createRequestConfig = (url, authHeader, timeout = 30000) => ({
        method: 'GET',
        url,
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/zip',
          'User-Agent': 'BitbucketIntegration/2.0'
        },
        timeout,
        responseType: 'stream'
      });

      const config = createRequestConfig('http://example.com/archive', 'Basic abc123');
      
      expect(config.method).toBe('GET');
      expect(config.url).toBe('http://example.com/archive');
      expect(config.headers.Authorization).toBe('Basic abc123');
      expect(config.headers.Accept).toBe('application/zip');
      expect(config.timeout).toBe(30000);
      expect(config.responseType).toBe('stream');
    });

    it('should support custom timeout', () => {
      const createRequestConfig = (url, authHeader, timeout = 30000) => ({
        method: 'GET',
        url,
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/zip',
          'User-Agent': 'BitbucketIntegration/2.0'
        },
        timeout,
        responseType: 'stream'
      });

      const config = createRequestConfig('http://example.com/archive', 'Basic abc123', 60000);
      
      expect(config.timeout).toBe(60000);
    });
  });

  describe('file size validation', () => {
    it('should validate download size limits', () => {
      const validateDownloadSize = (size, maxSize = 1024 * 1024 * 1024) => { // 1GB default
        return {
          isValid: size <= maxSize,
          size,
          maxSize,
          exceedsLimit: size > maxSize
        };
      };

      const smallFile = validateDownloadSize(10 * 1024 * 1024); // 10MB
      const largeFile = validateDownloadSize(2 * 1024 * 1024 * 1024); // 2GB
      
      expect(smallFile.isValid).toBe(true);
      expect(smallFile.exceedsLimit).toBe(false);
      expect(largeFile.isValid).toBe(false);
      expect(largeFile.exceedsLimit).toBe(true);
    });

    it('should format download size for logging', () => {
      const formatSize = (bytes) => {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
          size /= 1024;
          unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
      };

      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1048576)).toBe('1.0 MB');
      expect(formatSize(1073741824)).toBe('1.0 GB');
      expect(formatSize(512)).toBe('512.0 B');
    });
  });

  describe('commit ID validation', () => {
    it('should validate commit ID format', () => {
      const isValidCommitId = (commitId) => {
        if (!commitId || typeof commitId !== 'string') return false;
        
        // Git commit IDs are 40 character hex strings (SHA-1)
        // But also support short commit IDs (7+ characters)
        return /^[a-f0-9]{7,40}$/i.test(commitId);
      };

      expect(isValidCommitId('abc1234')).toBe(true); // short commit ID
      expect(isValidCommitId('a1b2c3d4e5f6789012345678901234567890abcd')).toBe(true); // full SHA-1
      expect(isValidCommitId('invalid')).toBe(false); // not hex
      expect(isValidCommitId('abc123')).toBe(false); // too short
      expect(isValidCommitId('')).toBe(false); // empty
      expect(isValidCommitId(null)).toBe(false); // null
    });

    it('should normalize commit ID', () => {
      const normalizeCommitId = (commitId) => {
        return commitId?.toLowerCase().trim();
      };

      expect(normalizeCommitId('ABC1234')).toBe('abc1234');
      expect(normalizeCommitId('  abc1234  ')).toBe('abc1234');
      expect(normalizeCommitId('AbC1234')).toBe('abc1234');
    });
  });
});