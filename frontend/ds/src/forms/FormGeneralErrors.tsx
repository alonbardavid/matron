import { Alert } from "@mantine/core";
import { GENERAL_ERROR_KEY, useFormContext } from "./context";

export function FormGeneralErrors() {
  const { form } = useFormContext();
  const error = form.errors[GENERAL_ERROR_KEY];
  if (!error) return null;
  return (
    <Alert color="red" variant="light" py="xs">
      {error}
    </Alert>
  );
}
