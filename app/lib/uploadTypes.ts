// Central allowlist for admin-uploaded image MIME types. Kept in code (not
// app_config) because app_config is DB-mutable — an admin or DB attacker
// could re-add `svg` and reopen the stored-XSS path the allowlist exists
// to close.
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
