// Status labels and colours for restocks in the admin area.
export const STATUS: Record<string, { cls: string; label: string }> = {
  open: { cls: 's-info', label: 'In progress' },
  finished: { cls: 's-ok', label: 'Complete' },
  finished_exceptions: { cls: 's-warn', label: 'Finished with exceptions' },
  unfinished: { cls: 's-bad', label: 'Unfinished' },
};
