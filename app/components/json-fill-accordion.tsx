"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";

import { Button } from "~/components/lightswind/button";
import { FormMessage } from "~/components/form-message";
import { BulkImportAccordion, JsonImportField } from "~/components/json-import";
import { toast } from "~/components/lightswind/toast";

/**
 * The *Bulk import from JSON* accordion used on every create page. Pasting JSON
 * never writes anything: the button hands the text to `onFill`, which parses it
 * and populates the form's own fields so the values can be reviewed and edited
 * before saving.
 *
 * Because it is a `type="button"`, filling the form also never triggers the
 * browser's "please fill in this field" validation on the manual inputs.
 */
export function JsonFillAccordion({
  sample,
  placeholder,
  hint,
  label = "Fill form from JSON",
  onFill,
}: {
  sample: string;
  placeholder?: string;
  hint?: React.ReactNode;
  label?: string;
  /** Parse `text` and fill the form; report back what happened. */
  onFill: (text: string) => { ok: true; message?: string } | { ok: false; error: string };
}) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const fill = () => {
    const result = onFill(text);
    if (result.ok) {
      setError(null);
      setNotice(result.message ?? "Filled the form from JSON. Review it, then save.");
      toast({ title: "Filled the form from JSON", variant: "success" });
    } else {
      setNotice(null);
      setError(result.error);
      toast({ title: result.error, variant: "error" });
    }
  };

  return (
    <BulkImportAccordion>
      <JsonImportField
        sample={sample}
        name={null}
        value={text}
        onValueChange={setText}
        placeholder={placeholder}
        hint={hint}
      >
        <Button type="button" variant="outline" size="sm" onClick={fill}>
          <UploadCloud /> {label}
        </Button>
      </JsonImportField>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {notice && <FormMessage tone="success">{notice}</FormMessage>}
    </BulkImportAccordion>
  );
}
