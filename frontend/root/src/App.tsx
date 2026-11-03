import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { HouseholdScreen } from "@frontend/auth/screens/HouseholdScreen";
import { LoginScreen } from "@frontend/auth/screens/LoginScreen";
import { useMe } from "@frontend/auth/useMe";
import { withBranch } from "@frontend/api/branch";
import { BranchesScreen } from "@frontend/branches/screens/BranchesScreen";
import { BuildChatProvider, useBuildChat } from "@frontend/build/BuildChatContext";
import { useOutOfDateAction } from "@frontend/build/outOfDate";
import { SessionsScreen } from "@frontend/build/screens/SessionsScreen";
import { TodoListScreen } from "@frontend/todo-list/screens/TodoListScreen";
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

function BranchesRoute() {
  const onOutOfDate = useOutOfDateAction();
  const buildChat = useBuildChat();
  return <BranchesScreen onOutOfDate={onOutOfDate} onViewSession={buildChat.open} />;
}

export function App() {
  const { me, isLoading, can, isOwner } = useMe();

  if (isLoading) return <Loading />;
  if (!me) return <LoginScreen />;

  return (
    <BuildChatProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<TodoListScreen />} />
          <Route
            path="branches"
            element={
              <Guard allow={can("view")}>
                <BranchesRoute />
              </Guard>
            }
          />
          <Route
            path="sessions"
            element={
              <Guard allow={can("create")}>
                <SessionsScreen />
              </Guard>
            }
          />
          <Route
            path="household"
            element={
              <Guard allow={isOwner}>
                <HouseholdScreen />
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to={withBranch("/")} replace />} />
        </Route>
      </Routes>
    </BuildChatProvider>
  );
}
