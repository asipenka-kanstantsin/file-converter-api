import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { RbacAdminService, RbacService } from '@/modules/rbac';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract, type HttpMethod } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface Named {
  id: string;
  name: string;
  system: boolean;
}

interface GrantBody {
  actions: string[];
  id: string;
  permissionId: string;
  roleId: string;
  system: boolean;
}

describe('RBAC administration', () => {
  let app: NestExpressApplication;
  let admin: SignedInUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signedInAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // Sends as `who` and checks the response against the contract.
  async function call(
    who: SignedInUser,
    method: HttpMethod,
    url: string,
    body?: object,
  ): Promise<request.Response> {
    const { agent, csrf } = who.client;
    const req = agent[method](url).set('X-CSRF-Token', csrf);
    const res = await (body === undefined ? req : req.send(body));
    expectContract(method, url, res);
    return res;
  }

  async function items<T>(url: string): Promise<T[]> {
    const res = await call(admin, 'get', url);
    expect(res.status).toBe(200);
    return (res.body as { items: T[] }).items;
  }

  async function byName(url: string, name: string): Promise<Named> {
    const found = (await items<Named>(url)).find((item) => item.name === name);
    if (!found) throw new Error(`${name} not found at ${url}`);
    return found;
  }

  async function createRole(name: string): Promise<Named> {
    const res = await call(admin, 'post', '/api/admin/rbac/roles', { name });
    expect(res.status).toBe(201);
    return (res.body as { role: Named }).role;
  }

  async function createPermission(
    name: string,
    actions: string[],
  ): Promise<Named> {
    const res = await call(admin, 'post', '/api/admin/rbac/permissions', {
      actions,
      name,
    });
    expect(res.status).toBe(201);
    return (res.body as { permission: Named }).permission;
  }

  async function createGrant(body: object): Promise<request.Response> {
    return call(admin, 'post', '/api/admin/rbac/grants', body);
  }

  function code(res: request.Response): unknown {
    return (res.body as { code?: unknown }).code;
  }

  describe('built-in configuration', () => {
    it('has the admin and user roles, the checked permissions and admin grants on each', async () => {
      const roles = await items<Named>('/api/admin/rbac/roles');
      const permissions = await items<Named & { actions: string[] }>(
        '/api/admin/rbac/permissions',
      );
      const grants = await items<GrantBody>('/api/admin/rbac/grants');

      expect(roles.map(({ name, system }) => ({ name, system }))).toEqual([
        { name: 'admin', system: true },
        { name: 'user', system: true },
      ]);
      expect(
        permissions.map(({ actions, name, system }) => ({
          actions,
          name,
          system,
        })),
      ).toEqual([
        { actions: ['manage'], name: 'rbac', system: true },
        { actions: ['manage'], name: 'settings', system: true },
        {
          actions: ['download', 'history'],
          name: 'transformations',
          system: true,
        },
        {
          actions: ['delete', 'list', 'read', 'update'],
          name: 'users',
          system: true,
        },
      ]);
      const adminId = roles[0]?.id;
      expect(grants).toHaveLength(4);
      expect(
        grants.every((g) => g.roleId === adminId && g.actions.length === 0),
      ).toBe(true);
      const rbacId = permissions[0]?.id;
      expect(grants.filter((g) => g.system).map((g) => g.permissionId)).toEqual(
        [rbacId],
      );
    });
  });

  describe('access', () => {
    it('refuses a signed-in user without the permission with 403 AUTH_FORBIDDEN', async () => {
      const user = await signedInUser(app);

      for (const [method, url] of [
        ['get', '/api/admin/rbac/roles'],
        ['post', '/api/admin/rbac/roles'],
        ['get', `/api/admin/users/${user.id}/roles`],
      ] as const) {
        const res = await call(
          user,
          method,
          url,
          method === 'get' ? undefined : { name: 'x1' },
        );
        expect(res.status).toBe(403);
        expect(code(res)).toBe('AUTH_FORBIDDEN');
      }
    });

    it('applies a rule change on the next request, without a restart', async () => {
      const user = await signedInUser(app);
      expect((await call(user, 'get', '/api/admin/settings')).status).toBe(403);

      const ops = await createRole('ops');
      const settings = await byName('/api/admin/rbac/permissions', 'settings');
      const grant = await createGrant({
        actions: ['manage'],
        permissionId: settings.id,
        roleId: ops.id,
      });
      expect(grant.status).toBe(201);
      await call(admin, 'put', `/api/admin/users/${user.id}/roles`, {
        roleIds: [ops.id],
      });
      expect((await call(user, 'get', '/api/admin/settings')).status).toBe(200);

      const grantId = (grant.body as { grant: GrantBody }).grant.id;
      expect(
        (await call(admin, 'delete', `/api/admin/rbac/grants/${grantId}`))
          .status,
      ).toBe(204);
      expect((await call(user, 'get', '/api/admin/settings')).status).toBe(403);
    });

    it('applies grants of the implicit user role to every account', async () => {
      const user = await signedInUser(app);
      const userRole = await byName('/api/admin/rbac/roles', 'user');
      const settings = await byName('/api/admin/rbac/permissions', 'settings');

      await createGrant({ permissionId: settings.id, roleId: userRole.id });

      expect((await call(user, 'get', '/api/admin/settings')).status).toBe(200);
    });

    it('never grants rbac to the implicit user role', async () => {
      const userRole = await byName('/api/admin/rbac/roles', 'user');
      const rbac = await byName('/api/admin/rbac/permissions', 'rbac');

      const res = await createGrant({
        permissionId: rbac.id,
        roleId: userRole.id,
      });

      expect([res.status, code(res)]).toEqual([409, 'RBAC_SYSTEM_ENTITY']);
    });
  });

  describe('roles', () => {
    it('creates, renames and deletes a role', async () => {
      const role = await createRole('support');

      const updated = await call(
        admin,
        'put',
        `/api/admin/rbac/roles/${role.id}`,
        {
          description: 'Answers tickets',
          name: 'helpdesk',
        },
      );
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        role: {
          description: 'Answers tickets',
          name: 'helpdesk',
          system: false,
        },
      });
      expect(
        (await call(admin, 'delete', `/api/admin/rbac/roles/${role.id}`))
          .status,
      ).toBe(204);
      expect(
        code(await call(admin, 'delete', `/api/admin/rbac/roles/${role.id}`)),
      ).toBe('RBAC_ROLE_NOT_FOUND');
    });

    it('refuses a taken or invalid name', async () => {
      await createRole('support');

      const taken = await call(admin, 'post', '/api/admin/rbac/roles', {
        name: 'support',
      });
      const invalid = await call(admin, 'post', '/api/admin/rbac/roles', {
        name: 'Not Valid',
      });

      expect([taken.status, code(taken)]).toEqual([
        409,
        'RBAC_ROLE_NAME_TAKEN',
      ]);
      expect([invalid.status, code(invalid)]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    });

    it('keeps the built-in roles', async () => {
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');

      const renamed = await call(
        admin,
        'put',
        `/api/admin/rbac/roles/${adminRole.id}`,
        {
          name: 'root',
        },
      );
      const deleted = await call(
        admin,
        'delete',
        `/api/admin/rbac/roles/${adminRole.id}`,
      );
      const described = await call(
        admin,
        'put',
        `/api/admin/rbac/roles/${adminRole.id}`,
        {
          description: 'Operators',
          name: 'admin',
        },
      );

      expect(code(renamed)).toBe('RBAC_SYSTEM_ENTITY');
      expect(code(deleted)).toBe('RBAC_SYSTEM_ENTITY');
      expect(described.status).toBe(200);
    });

    it('refuses to delete a role that grants or users still hold', async () => {
      const user = await signedInUser(app);
      const withGrant = await createRole('with-grant');
      const withUser = await createRole('with-user');
      const settings = await byName('/api/admin/rbac/permissions', 'settings');
      await createGrant({ permissionId: settings.id, roleId: withGrant.id });
      await call(admin, 'put', `/api/admin/users/${user.id}/roles`, {
        roleIds: [withUser.id],
      });

      for (const role of [withGrant, withUser]) {
        const res = await call(
          admin,
          'delete',
          `/api/admin/rbac/roles/${role.id}`,
        );
        expect([res.status, code(res)]).toEqual([409, 'RBAC_IN_USE']);
      }
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const unknown = await call(
        admin,
        'put',
        `/api/admin/rbac/roles/${UNKNOWN_ID}`,
        {
          name: 'ghost',
        },
      );
      const malformed = await call(
        admin,
        'delete',
        '/api/admin/rbac/roles/not-a-uuid',
      );

      expect([unknown.status, code(unknown)]).toEqual([
        404,
        'RBAC_ROLE_NOT_FOUND',
      ]);
      expect([malformed.status, code(malformed)]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    });
  });

  describe('permissions', () => {
    it('creates, updates and deletes a permission', async () => {
      const permission = await createPermission('reports', ['view']);

      const updated = await call(
        admin,
        'put',
        `/api/admin/rbac/permissions/${permission.id}`,
        { actions: ['export', 'view'], name: 'reports' },
      );
      expect(updated.body).toMatchObject({
        permission: { actions: ['export', 'view'], system: false },
      });
      expect(
        (
          await call(
            admin,
            'delete',
            `/api/admin/rbac/permissions/${permission.id}`,
          )
        ).status,
      ).toBe(204);
    });

    it('refuses duplicate actions, a taken name and built-in permissions', async () => {
      await createPermission('reports', ['view']);
      const users = await byName('/api/admin/rbac/permissions', 'users');

      const duplicate = await call(
        admin,
        'post',
        '/api/admin/rbac/permissions',
        {
          actions: ['view', 'view'],
          name: 'other',
        },
      );
      const taken = await call(admin, 'post', '/api/admin/rbac/permissions', {
        actions: ['view'],
        name: 'reports',
      });
      const builtIn = await call(
        admin,
        'put',
        `/api/admin/rbac/permissions/${users.id}`,
        {
          actions: ['read'],
          name: 'users',
        },
      );
      const builtInDelete = await call(
        admin,
        'delete',
        `/api/admin/rbac/permissions/${users.id}`,
      );

      expect(code(duplicate)).toBe('VALIDATION_FAILED');
      expect(code(taken)).toBe('RBAC_PERMISSION_NAME_TAKEN');
      expect(code(builtIn)).toBe('RBAC_SYSTEM_ENTITY');
      expect(code(builtInDelete)).toBe('RBAC_SYSTEM_ENTITY');
    });

    it('keeps actions that grants still list, and permissions that grants reference', async () => {
      const role = await createRole('viewer');
      const reports = await createPermission('reports', ['export', 'view']);
      await createGrant({
        actions: ['view'],
        permissionId: reports.id,
        roleId: role.id,
      });

      const shrunk = await call(
        admin,
        'put',
        `/api/admin/rbac/permissions/${reports.id}`,
        {
          actions: ['export'],
          name: 'reports',
        },
      );
      const deleted = await call(
        admin,
        'delete',
        `/api/admin/rbac/permissions/${reports.id}`,
      );

      expect([shrunk.status, code(shrunk)]).toEqual([
        409,
        'RBAC_ACTION_IN_USE',
      ]);
      expect(shrunk.body).toMatchObject({ context: { actions: ['view'] } });
      expect([deleted.status, code(deleted)]).toEqual([409, 'RBAC_IN_USE']);
    });
  });

  describe('grants', () => {
    it('validates the role, the permission and the actions', async () => {
      const role = await createRole('viewer');
      const reports = await createPermission('reports', ['view']);

      const unknownAction = await createGrant({
        actions: ['delete'],
        permissionId: reports.id,
        roleId: role.id,
      });
      const unknownRole = await createGrant({
        permissionId: reports.id,
        roleId: UNKNOWN_ID,
      });
      const unknownPermission = await createGrant({
        permissionId: UNKNOWN_ID,
        roleId: role.id,
      });
      const created = await createGrant({
        permissionId: reports.id,
        roleId: role.id,
      });
      const duplicate = await createGrant({
        permissionId: reports.id,
        roleId: role.id,
      });

      expect([unknownAction.status, code(unknownAction)]).toEqual([
        400,
        'RBAC_ACTION_NOT_ALLOWED',
      ]);
      expect(code(unknownRole)).toBe('RBAC_ROLE_NOT_FOUND');
      expect(code(unknownPermission)).toBe('RBAC_PERMISSION_NOT_FOUND');
      expect(created.body).toMatchObject({
        grant: { actions: [], system: false },
      });
      expect([duplicate.status, code(duplicate)]).toEqual([
        409,
        'RBAC_GRANT_DUPLICATE',
      ]);
    });

    it('updates a grant', async () => {
      const role = await createRole('viewer');
      const reports = await createPermission('reports', ['export', 'view']);
      const created = await createGrant({
        permissionId: reports.id,
        roleId: role.id,
      });
      const id = (created.body as { grant: GrantBody }).grant.id;

      const res = await call(admin, 'put', `/api/admin/rbac/grants/${id}`, {
        actions: ['view'],
        permissionId: reports.id,
        roleId: role.id,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ grant: { actions: ['view'] } });
    });

    it('cannot move another grant onto admin → rbac', async () => {
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');
      const rbac = await byName('/api/admin/rbac/permissions', 'rbac');
      const role = await createRole('viewer');
      const created = await createGrant({
        permissionId: rbac.id,
        roleId: role.id,
      });
      const id = (created.body as { grant: GrantBody }).grant.id;

      const moved = await call(admin, 'put', `/api/admin/rbac/grants/${id}`, {
        permissionId: rbac.id,
        roleId: adminRole.id,
      });

      expect([moved.status, code(moved)]).toEqual([
        409,
        'RBAC_GRANT_DUPLICATE',
      ]);
    });

    it('restores a tampered admin → rbac grant at startup', async () => {
      const prisma = prismaOf(app);
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');
      const rbac = await byName('/api/admin/rbac/permissions', 'rbac');
      await prisma.grant.delete({
        where: {
          roleId_permissionId: { permissionId: rbac.id, roleId: adminRole.id },
        },
      });

      await app.get(RbacService).initialize();

      const grants = await items<GrantBody>('/api/admin/rbac/grants');
      expect(
        grants.find(
          (g) => g.roleId === adminRole.id && g.permissionId === rbac.id,
        ),
      ).toMatchObject({ actions: [], system: true });
    });

    it('keeps the admin → rbac grant', async () => {
      const grant = (await items<GrantBody>('/api/admin/rbac/grants')).find(
        (g) => g.system,
      );
      if (!grant) throw new Error('no protected grant');

      const narrowed = await call(
        admin,
        'put',
        `/api/admin/rbac/grants/${grant.id}`,
        {
          actions: ['manage'],
          permissionId: grant.permissionId,
          roleId: grant.roleId,
        },
      );
      const deleted = await call(
        admin,
        'delete',
        `/api/admin/rbac/grants/${grant.id}`,
      );

      expect(code(narrowed)).toBe('RBAC_SYSTEM_ENTITY');
      expect(code(deleted)).toBe('RBAC_SYSTEM_ENTITY');
      expect(
        code(
          await call(admin, 'delete', `/api/admin/rbac/grants/${UNKNOWN_ID}`),
        ),
      ).toBe('RBAC_GRANT_NOT_FOUND');
    });
  });

  describe('user roles', () => {
    it('assigns and lists roles; the implicit user role is not listed', async () => {
      const user = await signedInUser(app);
      const role = await createRole('support');

      const put = await call(
        admin,
        'put',
        `/api/admin/users/${user.id}/roles`,
        {
          roleIds: [role.id],
        },
      );
      const get = await call(admin, 'get', `/api/admin/users/${user.id}/roles`);

      expect(put.body).toEqual({ roleIds: [role.id], userId: user.id });
      expect(get.body).toEqual({ roleIds: [role.id], userId: user.id });
    });

    it('refuses an unknown user or role, and the implicit user role', async () => {
      const user = await signedInUser(app);
      const userRole = await byName('/api/admin/rbac/roles', 'user');

      const unknownUser = await call(
        admin,
        'get',
        `/api/admin/users/${UNKNOWN_ID}/roles`,
      );
      const unknownRole = await call(
        admin,
        'put',
        `/api/admin/users/${user.id}/roles`,
        {
          roleIds: [UNKNOWN_ID],
        },
      );
      const implicit = await call(
        admin,
        'put',
        `/api/admin/users/${user.id}/roles`,
        {
          roleIds: [userRole.id],
        },
      );

      expect(code(unknownUser)).toBe('USER_NOT_FOUND');
      expect(unknownRole.body).toMatchObject({
        code: 'RBAC_ROLE_NOT_FOUND',
        context: { roleId: UNKNOWN_ID },
      });
      expect(code(implicit)).toBe('RBAC_SYSTEM_ENTITY');
    });

    it('gives roles only to accounts that can sign in', async () => {
      const user = await signedInUser(app);
      const role = await createRole('support');
      await prismaOf(app).user.update({
        data: { status: 'pending_verification' },
        where: { id: user.id },
      });

      const res = await call(
        admin,
        'put',
        `/api/admin/users/${user.id}/roles`,
        {
          roleIds: [role.id],
        },
      );

      expect([res.status, code(res)]).toEqual([409, 'USER_NOT_ACTIVE']);
      await expect(
        app.get(RbacAdminService).grantAdminByEmail(user.email),
      ).rejects.toMatchObject({ code: 'USER_NOT_ACTIVE' });
    });

    it('does not count an account that cannot sign in as an admin', async () => {
      const pending = await signedInUser(app);
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');
      const prisma = prismaOf(app);
      await prisma.userRole.create({
        data: { roleId: adminRole.id, userId: pending.id },
      });
      await prisma.user.update({
        data: { status: 'pending_verification' },
        where: { id: pending.id },
      });

      const res = await call(
        admin,
        'put',
        `/api/admin/users/${admin.id}/roles`,
        {
          roleIds: [],
        },
      );

      expect([res.status, code(res)]).toEqual([409, 'RBAC_LAST_ADMIN']);
    });

    it('lets only one of two admins demote themselves at the same time', async () => {
      const second = await signedInUser(app);
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');
      await call(admin, 'put', `/api/admin/users/${second.id}/roles`, {
        roleIds: [adminRole.id],
      });

      const results = await Promise.all(
        [admin, second].map((who) =>
          call(who, 'put', `/api/admin/users/${who.id}/roles`, { roleIds: [] }),
        ),
      );

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(
        await prismaOf(app).userRole.count({ where: { roleId: adminRole.id } }),
      ).toBe(1);
    });

    it('never removes the admin role from the last admin', async () => {
      const second = await signedInUser(app);
      const adminRole = await byName('/api/admin/rbac/roles', 'admin');

      const last = await call(
        admin,
        'put',
        `/api/admin/users/${admin.id}/roles`,
        {
          roleIds: [],
        },
      );
      expect([last.status, code(last)]).toEqual([409, 'RBAC_LAST_ADMIN']);
      expect((await call(admin, 'get', '/api/admin/rbac/roles')).status).toBe(
        200,
      );

      await call(admin, 'put', `/api/admin/users/${second.id}/roles`, {
        roleIds: [adminRole.id],
      });
      const handedOver = await call(
        admin,
        'put',
        `/api/admin/users/${admin.id}/roles`,
        {
          roleIds: [],
        },
      );
      expect(handedOver.status).toBe(200);
      expect((await call(admin, 'get', '/api/admin/rbac/roles')).status).toBe(
        403,
      );
      expect((await call(second, 'get', '/api/admin/rbac/roles')).status).toBe(
        200,
      );
    });
  });
});
