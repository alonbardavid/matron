/**
 * Everything a deployment owns is named after its Worker: the production D1
 * database, the R2 bucket, the Artifacts namespace and the code repository in
 * it, and the builder image. The Worker is told only its own name and origin.
 * scripts/lib/names.mjs is the same rule for the deploy scripts.
 */
export function deploymentNames(workerName: string): {
  database: string;
  bucket: string;
  namespace: string;
  repository: string;
  image: string;
} {
  return {
    database: workerName,
    bucket: workerName,
    namespace: workerName,
    repository: workerName,
    image: `${workerName}-builder`,
  };
}

/** The account's default AI Gateway; it exists from the first authenticated request. */
export const AI_GATEWAY = "default";
