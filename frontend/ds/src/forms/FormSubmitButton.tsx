import { Button, type ButtonProps } from "@mantine/core";
import type { ReactNode } from "react";
import { useFormContext } from "./context";

export function FormSubmitButton({
  children,
  ...props
}: ButtonProps & { children: ReactNode }) {
  const { submitting } = useFormContext();
  return (
    <Button type="submit" loading={submitting} {...props}>
      {children}
    </Button>
  );
}
