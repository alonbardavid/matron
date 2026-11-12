/** The app's pages by path, as the navigation and the phone's top bar name them. */
export const PAGE_TITLES: Record<string, string> = {
  "/": "Calendar",
  "/tasks": "Tasks",
  "/conversations": "Conversations",
  "/builds": "Builds",
  "/users": "Users",
  "/app-settings": "App settings",
  "/troubleshooting": "Troubleshooting",
  "/settings": "Settings",
};

export function pageTitle(pathname: string): string | null {
  return PAGE_TITLES[pathname] ?? null;
}
