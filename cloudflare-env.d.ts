declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CMS_ADMIN_HASH?: string;
  }
}
