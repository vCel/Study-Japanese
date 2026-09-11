"use client";

import * as React from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/lightswind/alert-dialog";
import { Button } from "~/components/lightswind/button";
import { toast } from "~/components/lightswind/toast";
import { cn } from "~/lib/utils";

/**
 * Destructive "Delete" control for the edit pages. It sits next to the form's
 * submit button and confirms through a Lightswind **Alert Dialog** instead of
 * deleting straight away.
 *
 * The confirm button submits the enclosing edit form with
 * `action=delete` using the HTML `form` attribute (a nested `<form>` would be
 * invalid markup), so the owning route action still runs its own permission
 * checks. On success the action returns `{ ok: true, deleted: true }`; pass
 * that back in as `deleted` and this component toasts and navigates away.
 */
export function DeleteButton({
  formId,
  label,
  redirectTo,
  deleted,
  description,
  className,
}: {
  /** `id` of the edit form this button submits. */
  formId: string;
  /** Lower-case noun, e.g. "word", "word list", "rule". */
  label: string;
  /** Where to go once the delete succeeds. */
  redirectTo: string;
  /** Pass `actionData?.deleted` from the owning route. */
  deleted?: boolean;
  description?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const title = label.charAt(0).toUpperCase() + label.slice(1);

  React.useEffect(() => {
    if (!deleted) return;
    toast({ title: `${title} deleted`, description, variant: "success" });
    navigate(redirectTo, { replace: true });
  }, [deleted, description, navigate, redirectTo, title]);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          className={cn("cursor-pointer", className)}
          title={`Delete this ${label}`}
        >
          <Trash2 /> Delete {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. {description ?? `The ${label} will be removed permanently.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="submit"
            form={formId}
            formNoValidate
            name="action"
            value="delete"
            className="bg-red-600 text-white shadow hover:bg-red-700"
          >
            <Trash2 /> Yes, delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
