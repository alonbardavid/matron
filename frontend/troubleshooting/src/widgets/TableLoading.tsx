import { Center, Loader } from "@mantine/core";

/** The section's place while its listing is read, tall enough not to jump when it lands. */
export function TableLoading() {
  return (
    <Center mih={220} py="xl">
      <Loader size="sm" />
    </Center>
  );
}
