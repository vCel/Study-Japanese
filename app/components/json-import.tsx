import * as React from "react";
import { FileJson } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/lightswind/accordion";
import { AnimatedCopyButton } from "~/components/lightswind/animated-copy-button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Label, Textarea } from "~/components/lightswind/input";
import { toast } from "~/components/lightswind/toast";

/**
 * Collapsible "bulk import" section used on every create page so the manual
 * form and the JSON import live side by side.
 */
export function BulkImportAccordion({
  title = "Bulk import from JSON",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <Accordion type="single" collapsible>
          <AccordionItem value="bulk" className="border-b-0">
            <AccordionTrigger className="py-0 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <FileJson className="h-4 w-4 text-primarylw" />
                {title}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0 pt-4">{children}</AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

/**
 * Large JSON textarea (with optional file picker + sample loader) used inside
 * a React Router `<Form>`. File contents are read into the textarea so they can
 * be inspected before submitting.
 *
 * Pass `value`/`onValueChange` when the caller needs to read the JSON itself
 * (the rules create page fills the form from it), and `name={null}` when the
 * textarea should not be submitted with the form.
 */
export function JsonImportField({
  sample,
  placeholder,
  hint,
  value,
  onValueChange,
  name = "json",
  children,
}: {
  sample: string;
  placeholder?: string;
  hint?: React.ReactNode;
  /** Controlled text; omit to let the field manage its own state. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Form field name — `null` keeps the textarea out of the submission. */
  name?: string | null;
  /** Extra controls rendered next to the sample/copy actions. */
  children?: React.ReactNode;
}) {
  const id = React.useId();
  const [internalText, setInternalText] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const text = value ?? internalText;
  const setText = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternalText(next);
      onValueChange?.(next);
    },
    [value, onValueChange]
  );

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  };

  const clearFile = () => {
    setText("");
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label htmlFor={id}>Paste JSON (or choose a file)</Label>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={`${id}-file`}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-border px-3 text-xs font-medium transition-colors hover:border-primarylw/40 hover:bg-muted"
          >
            <FileJson className="h-3.5 w-3.5 text-primarylw" />
            {fileName ?? "Choose file…"}
          </label>
          <input
            ref={fileInputRef}
            id={`${id}-file`}
            type="file"
            accept=".json,application/json,.txt"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          {fileName && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={clearFile}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="text-xs font-medium text-primarylw hover:underline"
            onClick={() => {
              setFileName(null);
              setText(sample);
            }}
          >
            Insert sample
          </button>
          <AnimatedCopyButton
            size="sm"
            textToCopy={sample}
            label="Copy the example JSON"
            onCopy={() => toast({ title: "Example JSON copied", variant: "success" })}
          />
          {children}
        </div>
      </div>
      <Textarea
        id={id}
        name={name ?? undefined}
        data-slot="json-import-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="min-h-[240px] font-mono text-xs"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
