// Everything a deployment owns is named after its Worker. The same rule as
// backend/commons/src/names.ts, for the scripts, which run without TypeScript.

/** @param {string} workerName */
export function deploymentNames(workerName) {
  return {
    database: workerName,
    bucket: workerName,
    namespace: workerName,
    repository: workerName,
    image: workerName,
    // Container application names are unique in an account.
    container: workerName,
  };
}
