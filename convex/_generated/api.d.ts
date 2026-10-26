/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as SmtpEmail from "../SmtpEmail.js";
import type * as auth from "../auth.js";
import type * as changePassword from "../changePassword.js";
import type * as constants from "../constants.js";
import type * as constraints from "../constraints.js";
import type * as credentialSync from "../credentialSync.js";
import type * as crons from "../crons.js";
import type * as hostingAccounts from "../hostingAccounts.js";
import type * as http from "../http.js";
import type * as orphanSites from "../orphanSites.js";
import type * as phpAudit from "../phpAudit.js";
import type * as phpVersions from "../phpVersions.js";
import type * as seedConstraints from "../seedConstraints.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as seedUser from "../seedUser.js";
import type * as sites from "../sites.js";
import type * as smtp from "../smtp.js";
import type * as ssoAuth from "../ssoAuth.js";
import type * as statuscakeSync from "../statuscakeSync.js";
import type * as sync from "../sync.js";
import type * as testAuth from "../testAuth.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  SmtpEmail: typeof SmtpEmail;
  auth: typeof auth;
  changePassword: typeof changePassword;
  constants: typeof constants;
  constraints: typeof constraints;
  credentialSync: typeof credentialSync;
  crons: typeof crons;
  hostingAccounts: typeof hostingAccounts;
  http: typeof http;
  orphanSites: typeof orphanSites;
  phpAudit: typeof phpAudit;
  phpVersions: typeof phpVersions;
  seedConstraints: typeof seedConstraints;
  seedTestUser: typeof seedTestUser;
  seedUser: typeof seedUser;
  sites: typeof sites;
  smtp: typeof smtp;
  ssoAuth: typeof ssoAuth;
  statuscakeSync: typeof statuscakeSync;
  sync: typeof sync;
  testAuth: typeof testAuth;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
