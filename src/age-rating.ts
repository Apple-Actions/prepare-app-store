/** String declaration fields on ageRatingDeclarations (ASC 2026). */
const AGE_RATING_STRING_FIELDS = [
  'alcoholTobaccoOrDrugUseOrReferences',
  'contests',
  'gamblingSimulated',
  'gunsOrOtherWeapons',
  'horrorOrFearThemes',
  'matureOrSuggestiveThemes',
  'medicalOrTreatmentInformation',
  'profanityOrCrudeHumor',
  'sexualContentGraphicAndNudity',
  'sexualContentOrNudity',
  'violenceCartoonOrFantasy',
  'violenceRealistic',
  'violenceRealisticProlongedGraphicOrSadistic'
] as const

/** Boolean declaration fields on ageRatingDeclarations (ASC 2026). */
const AGE_RATING_BOOLEAN_FIELDS = [
  'advertising',
  'ageAssurance',
  'gambling',
  'healthOrWellnessTopics',
  'lootBox',
  'messagingAndChat',
  'parentalControls',
  'socialMedia',
  'socialMediaAgeRestricted',
  'unrestrictedWebAccess',
  'userGeneratedContent'
] as const

export type AgeRatingAttributes = Record<string, string | boolean | null>

/** Expand `ageRating: none` into a full utility / no-content attribute set. */
export function noneAgeRatingAttributes(): AgeRatingAttributes {
  const attrs: AgeRatingAttributes = {}
  for (const key of AGE_RATING_STRING_FIELDS) {
    attrs[key] = 'NONE'
  }
  for (const key of AGE_RATING_BOOLEAN_FIELDS) {
    attrs[key] = false
  }
  attrs.ageRatingOverrideV2 = 'NONE'
  return attrs
}

export function resolveAgeRatingAttributes(
  ageRating: 'none' | AgeRatingAttributes | undefined
): AgeRatingAttributes | undefined {
  if (ageRating === undefined) {
    return undefined
  }
  if (ageRating === 'none') {
    return noneAgeRatingAttributes()
  }
  return {...ageRating}
}

/** True when pulled ASC attributes look like the utility `none` preset. */
export function isNoneAgeRatingAttributes(
  attrs: AgeRatingAttributes | undefined
): boolean {
  if (!attrs || !Object.keys(attrs).length) {
    return false
  }
  for (const key of AGE_RATING_STRING_FIELDS) {
    if (attrs[key] !== undefined && attrs[key] !== 'NONE') {
      return false
    }
  }
  for (const key of AGE_RATING_BOOLEAN_FIELDS) {
    if (attrs[key] !== undefined && attrs[key] !== false) {
      return false
    }
  }
  if (
    attrs.ageRatingOverrideV2 !== undefined &&
    attrs.ageRatingOverrideV2 !== 'NONE'
  ) {
    return false
  }
  return true
}
