import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profilesDir } from './paths.mjs';

/**
 * A profile describes one project: where tickets come from, which repository they
 * land in, and what "mergeable" means there. Profiles live in ~/.config, never in git.
 */
export function loadProfiles(dir = profilesDir) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const profile = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    validate(profile, f);
    return profile;
  });
}

function validate(p, file) {
  const missing = ['id', 'jira.projectKey', 'repo.path', 'repo.github', 'repo.baseBranch'].filter(
    (path) => path.split('.').reduce((o, k) => o?.[k], p) === undefined,
  );
  if (missing.length) throw new Error(`Profile ${file} is missing: ${missing.join(', ')}`);
}

export function profileForKey(profiles, key) {
  const project = key.split('-')[0];
  const p = profiles.find((x) => x.jira.projectKey === project);
  if (!p) throw new Error(`No profile for project ${project} (ticket ${key})`);
  return p;
}

export function profileById(profiles, id) {
  const p = profiles.find((x) => x.id === id);
  if (!p) throw new Error(`No profile with id ${id}`);
  return p;
}

export function assignedJql(p) {
  return p.jira.assignedJql || `project = ${p.jira.projectKey} AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
}
