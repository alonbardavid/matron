import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AskChatProvider } from "@frontend/ask/AskChatContext";
import { LoginScreen } from "@frontend/auth/screens/LoginScreen";
import { UsersScreen } from "@frontend/auth/screens/UsersScreen";
import { useMe } from "@frontend/auth/useMe";
import { withBranch } from "@frontend/api/branch";
import { BuildChatProvider } from "@frontend/build/BuildChatContext";
import { useOutOfDateAction } from "@frontend/build/outOfDate";
import { BuildsScreen } from "@frontend/build/screens/BuildsScreen";
import { CalendarScreen } from "@frontend/calendar/screens/CalendarScreen";
import { ConversationsScreen } from "@frontend/conversations/screens/ConversationsScreen";
import { AppSettingsScreen } from "@frontend/settings/screens/AppSettingsScreen";
import { SettingsScreen } from "@frontend/settings/screens/SettingsScreen";
import { TasksScreen } from "@frontend/tasks/screens/TasksScreen";
import { TroubleshootingScreen } from "@frontend/troubleshooting/screens/TroubleshootingScreen";
import { AppLayout } from "./AppLayout";

function Loading() {
  return (
    <Center mih="100vh">
      <Loader />
    </Center>
  );
}

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to={withBranch("/")} replace />;
}

function BuildsRoute() {
  const onOutOfDate = useOutOfDateAction();
  return <BuildsScreen onOutOfDate={onOutOfDate} />;
}

export function App() {
  const { me, isLoading, can, canManage, canTroubleshoot } = useMe();

  if (isLoading) return <Loading />;
  if (!me) return <LoginScreen />;

  return (
    <BuildChatProvider>
      <AskChatProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<CalendarScreen />} />
            <Route path="tasks" element={<TasksScreen />} />
            <Route path="conversations" element={<ConversationsScreen />} />
            <Route
              path="builds"
              element={
                <Guard allow={can("view")}>
                  <BuildsRoute />
                </Guard>
              }
            />
            {/* The page was called Branches; old links land on Builds. */}
            <Route
              path="branches"
              element={<Navigate to={withBranch("/builds")} replace />}
            />
            <Route
              path="users"
              element={
                <Guard allow={canManage}>
                  <UsersScreen />
                </Guard>
              }
            />
            <Route
              path="app-settings"
              element={
                <Guard allow={canManage}>
                  <AppSettingsScreen />
                </Guard>
              }
            />
            <Route
              path="troubleshooting"
              element={
                <Guard allow={canTroubleshoot}>
                  <TroubleshootingScreen />
                </Guard>
              }
            />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to={withBranch("/")} replace />} />
          </Route>
        </Routes>
      </AskChatProvider>
    </BuildChatProvider>
  );
}
