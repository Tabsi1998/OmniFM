// The Discord shop settings of the owner console (#320): switched on, and a
// SKU per plan. Pure, so the website data and the commander read the same.
const SNOWFLAKE = /^\d{17,22}$/;

const snowflake = (value) => {
  const text = String(value ?? "").trim();
  return SNOWFLAKE.test(text) ? text : "";
};

/**
 * @param {{ discordShop?: { enabled?: boolean, skus?: { pro?: string, ultimate?: string } } } | null | undefined} settings
 */
export function discordShopSettings(settings) {
  const raw = settings?.discordShop && typeof settings.discordShop === "object" ? settings.discordShop : {};
  const skus = raw.skus && typeof raw.skus === "object" ? raw.skus : {};
  return {
    enabled: raw.enabled === true,
    skus: { pro: snowflake(skus.pro), ultimate: snowflake(skus.ultimate) },
  };
}

/** @param {ReturnType<typeof discordShopSettings>} shop */
export function tierForSku(skuId, shop) {
  const sku = snowflake(skuId);
  if (!sku) return null;
  if (sku === shop.skus.ultimate) return "ultimate";
  if (sku === shop.skus.pro) return "pro";
  return null;
}

/** The app's store page in Discord, where the website sends buyers. */
export function discordStoreUrl(applicationId) {
  const id = snowflake(applicationId);
  return id ? `https://discord.com/application-directory/${id}/store` : "";
}

export { snowflake };
