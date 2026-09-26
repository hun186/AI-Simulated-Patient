export const ROLE_ADMIN='admin';
export const ROLE_TEACHER='teacher';
export const ROLE_STUDENT='student';

export const PERMISSIONS={
  CASE_MANAGE:'case.manage',
  RECORDS_READ_ALL:'records.read_all',
  RECORDS_READ_ASSIGNED:'records.read_assigned',
  STUDENT_MANAGE:'student.manage',
  USER_MANAGE_ALL:'user.manage_all',
  SECURITY_AUDIT_ALL:'security.audit_all',
  SECURITY_AUDIT_SELF:'security.audit_self',
  LLM_SETTINGS_MANAGE:'llm.settings_manage'
};

const ROLE_PERMISSIONS={
  [ROLE_ADMIN]:new Set(Object.values(PERMISSIONS)),
  [ROLE_TEACHER]:new Set([
    PERMISSIONS.CASE_MANAGE,
    PERMISSIONS.RECORDS_READ_ASSIGNED,
    PERMISSIONS.STUDENT_MANAGE,
    PERMISSIONS.SECURITY_AUDIT_SELF,
    PERMISSIONS.LLM_SETTINGS_MANAGE
  ]),
  [ROLE_STUDENT]:new Set([PERMISSIONS.SECURITY_AUDIT_SELF])
};

export function isKnownRole(role){
  return [ROLE_ADMIN,ROLE_TEACHER,ROLE_STUDENT].includes(role);
}

export function hasPermission(role,permission){
  return Boolean(ROLE_PERMISSIONS[role]?.has(permission));
}

export function rolesCreatableBy(role){
  if(role===ROLE_ADMIN) return [ROLE_ADMIN,ROLE_TEACHER,ROLE_STUDENT];
  if(role===ROLE_TEACHER) return [ROLE_STUDENT];
  return [];
}

export function isStaff(role){
  return role===ROLE_ADMIN || role===ROLE_TEACHER;
}
