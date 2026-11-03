/** What the session posts in the chat on its own behalf. */

/** Posted by the session when a build starts; `{title}` is replaced. */
export const BUILD_STARTED_MESSAGE =
  "The builder is working on **{title}** now. I will post here when there is something to try; this can take a while.";

/** Posted when a Preview is live; `{url}` is replaced. */
export const DEPLOYED_MESSAGE =
  "Your change is ready to try: [open the branch]({url}). The page reloads on the branch, with its own copy of the data. Keep asking for changes here, or merge it from the branch menu when you are happy.";

export const BUILD_FAILED_MESSAGE = "The build failed: {error}";

export const SESSION_CLOSED_MESSAGE =
  "This session is closed; start a new one for another change.";
