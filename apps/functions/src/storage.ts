import * as admin from "firebase-admin";

function resolveBucketName(): string | null {
  const directValue =
    process.env.STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.GCLOUD_STORAGE_BUCKET;

  if (directValue) {
    return directValue;
  }

  if (!process.env.FIREBASE_CONFIG) {
    return null;
  }

  try {
    const parsed = JSON.parse(process.env.FIREBASE_CONFIG) as { storageBucket?: string };
    return parsed.storageBucket || null;
  } catch (_error) {
    return null;
  }
}

export function getStorageBucket() {
  const bucketName = resolveBucketName();
  if (bucketName) {
    return admin.storage().bucket(bucketName);
  }

  return admin.storage().bucket();
}
