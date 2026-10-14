import { apiRequest, type ApiResult } from '../../lib/apiClient';
import { SETUP_UNAVAILABLE, toEnrollSetup, type EnrollSetup } from '../../lib/adminSecurity';
import { SecurityRequestError, reauthenticate } from '../../_security/reauth';
import {
  CODES_UNAVAILABLE,
  DEVICE_SIGN_OUT_FAILED,
  EVERYWHERE_SIGN_OUT_FAILED,
  OTHERS_SIGN_OUT_FAILED,
  RECOVERY_CODES_PATH,
  SETUP_START_PATH,
  SIGN_OUT_EVERYWHERE_PATH,
  SIGN_OUT_OTHERS_PATH,
  sessionPath,
  toDeviceSignOut,
  toNewRecoveryCodes,
  toOthersSignOut,
  type DeviceSignOut,
  type NewRecoveryCodes,
  type OthersSignOut,
} from './securityModel';

function settled<T>(result: ApiResult<T>, fallback: string): T {
  if (!result.ok) throw new SecurityRequestError(result.error, fallback);
  return result.data;
}

export async function startProfileSetup(password: string): Promise<EnrollSetup> {
  await reauthenticate('password', password);
  const result = await apiRequest<EnrollSetup>(SETUP_START_PATH, { method: 'POST', body: {}, select: toEnrollSetup });
  return settled(result, SETUP_UNAVAILABLE);
}

export async function replaceRecoveryCodes(otp: string): Promise<NewRecoveryCodes> {
  const result = await apiRequest<NewRecoveryCodes>(RECOVERY_CODES_PATH, {
    method: 'POST',
    body: { otp },
    select: toNewRecoveryCodes,
  });
  return settled(result, CODES_UNAVAILABLE);
}

export async function signOutDevice(sessionId: string): Promise<DeviceSignOut> {
  const result = await apiRequest<DeviceSignOut>(sessionPath(sessionId), { method: 'DELETE', select: toDeviceSignOut });
  return settled(result, DEVICE_SIGN_OUT_FAILED);
}

export async function signOutOtherDevices(): Promise<OthersSignOut> {
  const result = await apiRequest<OthersSignOut>(SIGN_OUT_OTHERS_PATH, { method: 'POST', select: toOthersSignOut });
  return settled(result, OTHERS_SIGN_OUT_FAILED);
}

export async function signOutEverywhere(): Promise<true> {
  settled(await apiRequest(SIGN_OUT_EVERYWHERE_PATH, { method: 'POST' }), EVERYWHERE_SIGN_OUT_FAILED);
  return true;
}
