import { withBranch } from "@frontend/api/branch";
import { Box } from "@mantine/core";
import { Link } from "react-router-dom";

interface WordmarkProps {
  height?: number;
  /** On the plum shell the lockup is always white; elsewhere it follows the colour scheme. */
  onShell?: boolean;
}

/** The Matron lockup, mark and wordmark, linking home. */
export function Wordmark({ height = 26, onShell = false }: WordmarkProps) {
  return (
    <Box
      component={Link}
      to={withBranch("/")}
      aria-label="Matron"
      style={{ display: "inline-flex" }}
    >
      {onShell ? (
        <img src="/brand/matron-lockup-white.svg" alt="Matron" height={height} />
      ) : (
        <>
          <img
            src="/brand/matron-lockup.svg"
            alt="Matron"
            height={height}
            data-light-only=""
          />
          <img
            src="/brand/matron-lockup-white.svg"
            alt=""
            height={height}
            data-dark-only=""
          />
        </>
      )}
    </Box>
  );
}
