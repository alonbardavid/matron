import { withBranch } from "@frontend/api/branch";
import { Text } from "@mantine/core";
import { Link } from "react-router-dom";

export function Wordmark() {
  return (
    <Text
      component={Link}
      to={withBranch("/")}
      fw={800}
      fz="lg"
      c="clay"
      style={{ letterSpacing: "0.04em", textDecoration: "none" }}
    >
      Matron
    </Text>
  );
}
