import { createContext, useContext, type ReactNode } from "react";
import {
  useForm as useMantineForm,
  type UseFormInput,
  type UseFormReturnType,
} from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import type { $ZodType } from "zod/v4/core";

/** Field key that carries an error about the whole submission rather than one input. */
export const GENERAL_ERROR_KEY = "general";

type AnyValues = Record<string, unknown>;

export type FormOptions<T extends AnyValues> = Omit<UseFormInput<T>, "validate"> & {
  schema?: $ZodType;
};

export function useForm<T extends AnyValues>(
  options: FormOptions<T>,
): UseFormReturnType<T> {
  const { schema, ...rest } = options;
  return useMantineForm<T>({
    mode: "uncontrolled",
    ...rest,
    validate: schema ? zod4Resolver(schema) : undefined,
  });
}

interface FormContextValue {
  form: UseFormReturnType<AnyValues>;
  submitting: boolean;
}

const FormContext = createContext<FormContextValue | null>(null);

export function FormProvider<T extends AnyValues>({
  form,
  submitting,
  children,
}: {
  form: UseFormReturnType<T>;
  submitting: boolean;
  children: ReactNode;
}) {
  const value: FormContextValue = {
    form: form as unknown as UseFormReturnType<AnyValues>,
    submitting,
  };
  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}

export function useFormContext<T extends AnyValues = AnyValues>(): {
  form: UseFormReturnType<T>;
  submitting: boolean;
} {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("Form inputs must be rendered inside a StandardForm");
  return {
    form: ctx.form as unknown as UseFormReturnType<T>,
    submitting: ctx.submitting,
  };
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || "Something went wrong";
  if (typeof err === "string") return err;
  return "Something went wrong";
}
