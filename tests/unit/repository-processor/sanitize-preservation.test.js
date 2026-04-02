import { describe, it, expect, beforeAll } from '@jest/globals';
import { S3Uploader } from '../../../app/bitbucket-integration-v2/repository-processor/lib/uploader.js';

/**
 * Preservation Property Test — Safe Branch Names Unchanged
 *
 * Validates: Requirements 3.1, 3.2
 *
 * For branch names containing only safe characters [a-zA-Z0-9\-_.],
 * the output must equal input.toLowerCase().
 * This must hold on both unfixed and fixed code.
 */
describe('Preservation: safe branch names unchanged', () => {
  let uploader;

  beforeAll(() => {
    uploader = new S3Uploader();
  });

  it('should preserve "main" as "main"', () => {
    expect(uploader.sanitizeS3KeyComponent('main')).toBe('main');
  });

  it('should preserve "release-1.0.0" as "release-1.0.0"', () => {
    expect(uploader.sanitizeS3KeyComponent('release-1.0.0')).toBe('release-1.0.0');
  });

  it('should preserve "v1.2.3" as "v1.2.3"', () => {
    expect(uploader.sanitizeS3KeyComponent('v1.2.3')).toBe('v1.2.3');
  });

  it('should preserve "feature_flag" as "feature_flag"', () => {
    expect(uploader.sanitizeS3KeyComponent('feature_flag')).toBe('feature_flag');
  });

  it('should normalize case: "DEVELOP" becomes "develop"', () => {
    expect(uploader.sanitizeS3KeyComponent('DEVELOP')).toBe('develop');
  });

  it('should produce correct generateS3Key format for safe inputs', () => {
    const key = uploader.generateS3Key('MyProject', 'my-repo', 'main', 'corr-1');
    expect(key).toBe('repositories/myproject/my-repo/main/source.zip');
  });
});
