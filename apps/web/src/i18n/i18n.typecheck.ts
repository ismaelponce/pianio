import i18n from "./index";

i18n.t("document.title");
i18n.t("common:document.title");
// @ts-expect-error Unknown common keys must fail type checking.
i18n.t("document.notARealKey");
// @ts-expect-error Unknown namespaces must fail type checking.
i18n.t("madeUp:someKey");
