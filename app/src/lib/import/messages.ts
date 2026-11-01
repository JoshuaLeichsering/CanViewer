/**
 * UI strings of the import UI (progress, source format, clusters), merged
 * into the dictionaries in app/src/lib/i18n.tsx. Kept here, with the `imp`
 * prefix, so the import UI's strings stay together. Format names (ARXML,
 * KCD, ...) and "canmatrix" are not translated.
 */
export const impEn = {
  impProgressTitle: 'Opening {name}',
  impStepRuntime: 'Python runtime',
  impStepRuntimeHint: 'loaded once per session',
  impStepPackages: 'Format support',
  impStepReading: 'Reading with canmatrix',
  impStepDone: 'done',
  impStepActive: 'in progress',
  impStepPending: 'waiting',
  impSourceTitle: 'Imported from {format}',
  impSourceLossy:
    'Read with canmatrix and converted to CanViewer’s model. The conversion may be lossy: what canmatrix cannot read, or does not model, is missing here.',
  impSourceProblemsOne: 'Show the problem canmatrix reported',
  impSourceProblemsMany: 'Show the {n} problems canmatrix reported',
  impSourceNoProblems: 'canmatrix reported no problems.',
  impClustersTitle: 'Clusters',
  impClustersHint: 'This file holds {n} clusters. Pick the one to show:',
  impClusterUnnamed: 'unnamed',
  impRestoreFailed: 'Could not restore {name}: {error}',
};

export const impDe: Record<keyof typeof impEn, string> = {
  impProgressTitle: '{name} wird geöffnet',
  impStepRuntime: 'Python-Laufzeit',
  impStepRuntimeHint: 'einmal pro Sitzung geladen',
  impStepPackages: 'Formatunterstützung',
  impStepReading: 'Lesen mit canmatrix',
  impStepDone: 'erledigt',
  impStepActive: 'läuft',
  impStepPending: 'wartet',
  impSourceTitle: 'Importiert aus {format}',
  impSourceLossy:
    'Mit canmatrix gelesen und in CanViewers Modell umgewandelt. Die Umwandlung kann verlustbehaftet sein: Was canmatrix nicht lesen kann oder nicht abbildet, fehlt hier.',
  impSourceProblemsOne: 'Das von canmatrix gemeldete Problem anzeigen',
  impSourceProblemsMany: 'Die {n} von canmatrix gemeldeten Probleme anzeigen',
  impSourceNoProblems: 'canmatrix hat keine Probleme gemeldet.',
  impClustersTitle: 'Cluster',
  impClustersHint: 'Diese Datei enthält {n} Cluster. Welcher soll angezeigt werden?',
  impClusterUnnamed: 'ohne Namen',
  impRestoreFailed: '{name} konnte nicht wiederhergestellt werden: {error}',
};
