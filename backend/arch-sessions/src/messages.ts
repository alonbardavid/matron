/** What the session posts in the chat on its own behalf. */

/** Posted when a Preview is live; `{url}` is replaced. */
export const DEPLOYED_MESSAGE =
  "Your change is ready to try: [open the branch]({url}). The page reloads on the branch, with its own copy of the data. Keep asking for changes here, or merge it from the branch menu when you are happy.";

export const BUILD_FAILED_MESSAGE = "The build failed: {error}";

/** Posted when a builder run ends without a word from the builder; `{reason}` is replaced. */
export const BUILD_INTERRUPTED_MESSAGE =
  "The builder stopped unexpectedly: {reason}. Reply here to pick the work up again.";
