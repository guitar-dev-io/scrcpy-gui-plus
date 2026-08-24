import { invoke } from '@tauri-apps/api/core'
import type { ApkSetBackupResult, ApkSetValidationResult } from '../types/apkBackup'

type UnknownRecord = Record<string, unknown>
const object = (value: unknown): UnknownRecord => value && typeof value === 'object' ? value as UnknownRecord : {}
const text = (value: unknown) => typeof value === 'string' ? value : undefined
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const boolean = (value: unknown) => typeof value === 'boolean' ? value : undefined
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function normalizeValidation(value: unknown, fallbackPath = ''): ApkSetValidationResult {
  const raw = object(value)
  return {
    valid: raw.valid === true,
    path: text(raw.path) ?? fallbackPath,
    schemaVersion: number(raw.schemaVersion),
    packageName: text(raw.packageName),
    apkCount: number(raw.apkCount) ?? 0,
    partial: boolean(raw.partial),
    includesAppData: boolean(raw.includesAppData),
    warnings: strings(raw.warnings),
    error: text(raw.error),
    errorCode: text(raw.errorCode),
  }
}

export async function createApkSetBackup(options: {
  serial: string
  packageName: string
  outputDirectory: string
  customPath?: string
}): Promise<ApkSetBackupResult> {
  const raw = object(await invoke<unknown>('create_apk_set_backup', {
    serial: options.serial,
    package: options.packageName,
    outputDir: options.outputDirectory,
    customPath: options.customPath,
  }))
  const outputPath = text(raw.outputPath)
  return {
    success: raw.success === true,
    partial: raw.partial === true,
    packageName: text(raw.packageName) ?? options.packageName,
    deviceSerial: text(raw.deviceSerial) ?? options.serial,
    outputPath,
    exportedCount: number(raw.exportedCount) ?? 0,
    failedCount: number(raw.failedCount) ?? 0,
    analysisAvailable: raw.analysisAvailable === true,
    validation: raw.validation ? normalizeValidation(raw.validation, outputPath) : undefined,
    warnings: strings(raw.warnings),
    error: text(raw.error),
    errorCode: text(raw.errorCode),
  }
}

export async function validateApkSetArchive(path: string): Promise<ApkSetValidationResult> {
  return normalizeValidation(await invoke<unknown>('validate_apk_set_archive', { path }), path)
}
