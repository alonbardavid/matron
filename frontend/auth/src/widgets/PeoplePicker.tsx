import { MultiSelect, type MultiSelectProps } from "@mantine/core";
import { useHouseholdMembers } from "../useHouseholdMembers";

interface PeoplePickerProps extends Omit<
  MultiSelectProps,
  "data" | "value" | "onChange"
> {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Member ids to leave out, such as the creator. */
  exclude?: string[];
  /** Member ids to offer; others are left out. */
  only?: string[];
}

/** Household members by name, as a multi-select of user ids. */
export function PeoplePicker({
  value,
  onChange,
  exclude = [],
  only,
  ...props
}: PeoplePickerProps) {
  const { members } = useHouseholdMembers();
  const data = members
    .filter((member) => !exclude.includes(member.id))
    .filter((member) => !only || only.includes(member.id))
    .map((member) => ({ value: member.id, label: member.name }));
  return (
    <MultiSelect
      data={data}
      value={value.filter((id) => data.some((item) => item.value === id))}
      onChange={onChange}
      searchable
      clearable
      nothingFoundMessage="No one else"
      {...props}
    />
  );
}
