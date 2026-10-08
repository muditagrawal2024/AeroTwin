// Reference list prices (USD) used by the billing simulator.
// Values follow the published Amazon S3 list prices for US East (N. Virginia);
// they can be overridden from the Billing page so the numbers can be matched
// to any region on the day of a demo.

export const STORAGE_CLASSES = {
  STANDARD: { label: 'S3 Standard', short: 'Standard', minDays: 0, retrieval: 0, archived: false, color: 'var(--c-std)' },
  STANDARD_IA: { label: 'S3 Standard-IA', short: 'Standard-IA', minDays: 30, retrieval: 0.01, archived: false, color: 'var(--c-ia)' },
  GLACIER_IR: { label: 'S3 Glacier Instant Retrieval', short: 'Glacier IR', minDays: 90, retrieval: 0.03, archived: false, color: 'var(--c-gir)' },
  GLACIER: { label: 'S3 Glacier Flexible Retrieval', short: 'Glacier Flexible', minDays: 90, retrieval: 0.01, archived: true, restoreHours: 4, color: 'var(--c-gfr)' },
  DEEP_ARCHIVE: { label: 'S3 Glacier Deep Archive', short: 'Deep Archive', minDays: 180, retrieval: 0.02, archived: true, restoreHours: 12, color: 'var(--c-gda)' }
};

export const DEFAULT_PRICES = {
  storage: { STANDARD: 0.023, STANDARD_IA: 0.0125, GLACIER_IR: 0.004, GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 },
  putPer1k: 0.005,     // PUT, COPY, POST, LIST
  getPer1k: 0.0004,    // GET, SELECT and all other requests
  transferOutPerGB: 0.09,
  usdToInr: 84
};

export const FREE_TIER = { standardGB: 5, getRequests: 20000, putRequests: 2000, transferOutGB: 100 };

export const PUT_CLASS = new Set(['PutObject', 'CopyObject', 'ListObjectsV2', 'ListObjectVersions', 'ListBuckets', 'CreateBucket', 'PutBucketVersioning', 'PutBucketPolicy', 'DeleteBucketPolicy', 'PutBucketLifecycleConfiguration', 'PutBucketNotificationConfiguration', 'PutBucketEncryption', 'PutPublicAccessBlock', 'PutBucketTagging', 'RestoreObject', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'PutObjectTagging']);
// DELETE and CANCEL requests are free in S3; presigning happens client-side.
export const FREE_REQUESTS = new Set(['DeleteObject', 'DeleteBucket', 'DeleteObjects', 'LifecycleTransition', 'LifecycleExpiration', 'GeneratePresignedUrl']);

export const GB = 1024 ** 3;
export const MONTH_MS = 30 * 24 * 3600 * 1000; // one billing GB-month
