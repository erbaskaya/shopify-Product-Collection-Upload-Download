export type ShopifyFieldGroup =
  | "Product"
  | "Variant"
  | "Image"
  | "SEO"
  | "Google Shopping"
  | "Markets and pricing";

export interface ShopifyImportField {
  id: string;
  label: string;
  group: ShopifyFieldGroup;
  description: string;
  aliases: string[];
}

export type ColumnMapping = Record<string, string>;

export const SHOPIFY_IMPORT_FIELDS: ShopifyImportField[] = [
  {
    id: "handle",
    label: "Handle",
    group: "Product",
    description: "The product URL key and grouping value.",
    aliases: ["Handle", "Product Handle", "Ürün Handle"],
  },
  {
    id: "title",
    label: "Title",
    group: "Product",
    description: "Product title.",
    aliases: ["Title", "Product Title", "Ürün Başlığı", "Başlık"],
  },
  {
    id: "bodyHtml",
    label: "Body (HTML)",
    group: "Product",
    description: "Product description and HTML content.",
    aliases: [
      "Body (HTML)",
      "Body HTML",
      "Description",
      "Product Description",
      "Açıklama",
      "Ürün Açıklaması",
    ],
  },
  {
    id: "vendor",
    label: "Vendor",
    group: "Product",
    description: "Product brand or manufacturer.",
    aliases: ["Vendor", "Brand", "Marka", "Üretici"],
  },
  {
    id: "productCategory",
    label: "Product Category",
    group: "Product",
    description: "Shopify standard product category.",
    aliases: [
      "Product Category",
      "Shopify Product Category",
      "Ürün Kategorisi",
      "Kategori",
    ],
  },
  {
    id: "productType",
    label: "Type",
    group: "Product",
    description: "Product type.",
    aliases: ["Type", "Product Type", "Ürün Tipi"],
  },
  {
    id: "tags",
    label: "Tags",
    group: "Product",
    description: "Comma-separated product tags.",
    aliases: ["Tags", "Product Tags", "Etiketler", "Tag"],
  },
  {
    id: "published",
    label: "Published",
    group: "Product",
    description: "Indicates whether the product is published.",
    aliases: ["Published", "Yayınlandı", "Yayın Durumu"],
  },
  {
    id: "status",
    label: "Status",
    group: "Product",
    description: "Active, draft, or archived status.",
    aliases: ["Status", "Product Status", "Durum"],
  },
  {
    id: "giftCard",
    label: "Gift Card",
    group: "Product",
    description: "Indicates whether the product is a gift card.",
    aliases: ["Gift Card", "Hediye Kartı"],
  },
  {
    id: "collections",
    label: "Collections",
    group: "Product",
    description: "Collections to which the product will be added.",
    aliases: [
      "Collections",
      "Collection",
      "Koleksiyonlar",
      "Koleksiyon",
    ],
  },

  {
    id: "option1Name",
    label: "Option1 Name",
    group: "Variant",
    description: "Name of the first variant option.",
    aliases: ["Option1 Name", "Option 1 Name", "Seçenek 1 Adı"],
  },
  {
    id: "option1Value",
    label: "Option1 Value",
    group: "Variant",
    description: "Value of the first variant option.",
    aliases: ["Option1 Value", "Option 1 Value", "Seçenek 1 Değeri"],
  },
  {
    id: "option1LinkedTo",
    label: "Option1 Linked To",
    group: "Variant",
    description: "Linked metafield value for the first option.",
    aliases: ["Option1 Linked To", "Option 1 Linked To"],
  },
  {
    id: "option2Name",
    label: "Option2 Name",
    group: "Variant",
    description: "Name of the second variant option.",
    aliases: ["Option2 Name", "Option 2 Name", "Seçenek 2 Adı"],
  },
  {
    id: "option2Value",
    label: "Option2 Value",
    group: "Variant",
    description: "Value of the second variant option.",
    aliases: ["Option2 Value", "Option 2 Value", "Seçenek 2 Değeri"],
  },
  {
    id: "option2LinkedTo",
    label: "Option2 Linked To",
    group: "Variant",
    description: "Linked metafield value for the second option.",
    aliases: ["Option2 Linked To", "Option 2 Linked To"],
  },
  {
    id: "option3Name",
    label: "Option3 Name",
    group: "Variant",
    description: "Name of the third variant option.",
    aliases: ["Option3 Name", "Option 3 Name", "Seçenek 3 Adı"],
  },
  {
    id: "option3Value",
    label: "Option3 Value",
    group: "Variant",
    description: "Value of the third variant option.",
    aliases: ["Option3 Value", "Option 3 Value", "Seçenek 3 Değeri"],
  },
  {
    id: "option3LinkedTo",
    label: "Option3 Linked To",
    group: "Variant",
    description: "Linked metafield value for the third option.",
    aliases: ["Option3 Linked To", "Option 3 Linked To"],
  },
  {
    id: "variantSku",
    label: "Variant SKU",
    group: "Variant",
    description: "Unique inventory code for the variant.",
    aliases: ["Variant SKU", "SKU", "Stok Kodu"],
  },
  {
    id: "variantGrams",
    label: "Variant Grams",
    group: "Variant",
    description: "Variant weight in grams.",
    aliases: ["Variant Grams", "Grams", "Gram"],
  },
  {
    id: "variantInventoryTracker",
    label: "Variant Inventory Tracker",
    group: "Variant",
    description: "Specifies the inventory tracking system.",
    aliases: ["Variant Inventory Tracker", "Inventory Tracker"],
  },
  {
    id: "variantInventoryQty",
    label: "Variant Inventory Qty",
    group: "Variant",
    description: "Variant inventory quantity.",
    aliases: [
      "Variant Inventory Qty",
      "Inventory Qty",
      "Inventory Quantity",
      "Stok",
      "Stok Miktarı",
    ],
  },
  {
    id: "variantInventoryPolicy",
    label: "Variant Inventory Policy",
    group: "Variant",
    description: "Determines the selling policy when inventory is depleted.",
    aliases: ["Variant Inventory Policy", "Inventory Policy"],
  },
  {
    id: "variantFulfillmentService",
    label: "Variant Fulfillment Service",
    group: "Variant",
    description: "Variant fulfillment service.",
    aliases: ["Variant Fulfillment Service", "Fulfillment Service"],
  },
  {
    id: "variantPrice",
    label: "Variant Price",
    group: "Variant",
    description: "Variant selling price.",
    aliases: ["Variant Price", "Price", "Fiyat", "Satış Fiyatı"],
  },
  {
    id: "variantCompareAtPrice",
    label: "Variant Compare At Price",
    group: "Variant",
    description: "Variant compare-at or previous price.",
    aliases: [
      "Variant Compare At Price",
      "Compare At Price",
      "Karşılaştırma Fiyatı",
      "Eski Fiyat",
    ],
  },
  {
    id: "variantRequiresShipping",
    label: "Variant Requires Shipping",
    group: "Variant",
    description: "Indicates whether physical shipping is required.",
    aliases: ["Variant Requires Shipping", "Requires Shipping"],
  },
  {
    id: "variantTaxable",
    label: "Variant Taxable",
    group: "Variant",
    description: "Indicates whether the variant is taxable.",
    aliases: ["Variant Taxable", "Taxable", "Vergiye Tabi"],
  },
  {
    id: "variantBarcode",
    label: "Variant Barcode",
    group: "Variant",
    description: "EAN, UPC, GTIN, or barcode value.",
    aliases: [
      "Variant Barcode",
      "Barcode",
      "EAN",
      "GTIN",
      "UPC",
      "Barkod",
    ],
  },
  {
    id: "variantImage",
    label: "Variant Image",
    group: "Variant",
    description: "Image URL linked to the variant.",
    aliases: ["Variant Image", "Variant Image Src", "Varyant Görseli"],
  },
  {
    id: "variantWeightUnit",
    label: "Variant Weight Unit",
    group: "Variant",
    description: "Weight unit.",
    aliases: ["Variant Weight Unit", "Weight Unit", "Ağırlık Birimi"],
  },
  {
    id: "variantTaxCode",
    label: "Variant Tax Code",
    group: "Variant",
    description: "Variant tax code.",
    aliases: ["Variant Tax Code", "Tax Code"],
  },
  {
    id: "costPerItem",
    label: "Cost per item",
    group: "Variant",
    description: "Product or variant cost.",
    aliases: ["Cost per item", "Cost Per Item", "Cost", "Maliyet"],
  },

  {
    id: "imageSrc",
    label: "Image Src",
    group: "Image",
    description: "Product image URL.",
    aliases: [
      "Image Src",
      "Image URL",
      "Product Image",
      "Görsel URL",
      "Ürün Görseli",
    ],
  },
  {
    id: "imagePosition",
    label: "Image Position",
    group: "Image",
    description: "Image position within the product.",
    aliases: ["Image Position", "Görsel Sırası"],
  },
  {
    id: "imageAltText",
    label: "Image Alt Text",
    group: "Image",
    description: "Image alternative text.",
    aliases: ["Image Alt Text", "Image Alt", "Alt Text", "Görsel Alt Metni"],
  },

  {
    id: "seoTitle",
    label: "SEO Title",
    group: "SEO",
    description: "Search engine title.",
    aliases: ["SEO Title", "Meta Title", "SEO Başlığı"],
  },
  {
    id: "seoDescription",
    label: "SEO Description",
    group: "SEO",
    description: "Search engine description.",
    aliases: ["SEO Description", "Meta Description", "SEO Açıklaması"],
  },

  {
    id: "googleProductCategory",
    label: "Google Shopping / Google Product Category",
    group: "Google Shopping",
    description: "Google product category.",
    aliases: [
      "Google Shopping / Google Product Category",
      "Google Product Category",
    ],
  },
  {
    id: "googleGender",
    label: "Google Shopping / Gender",
    group: "Google Shopping",
    description: "Google Shopping gender.",
    aliases: ["Google Shopping / Gender", "Gender"],
  },
  {
    id: "googleAgeGroup",
    label: "Google Shopping / Age Group",
    group: "Google Shopping",
    description: "Google Shopping age group.",
    aliases: ["Google Shopping / Age Group", "Age Group"],
  },
  {
    id: "googleMpn",
    label: "Google Shopping / MPN",
    group: "Google Shopping",
    description: "Manufacturer part number.",
    aliases: ["Google Shopping / MPN", "MPN"],
  },
  {
    id: "googleCondition",
    label: "Google Shopping / Condition",
    group: "Google Shopping",
    description: "Product condition, such as new or used.",
    aliases: ["Google Shopping / Condition", "Condition"],
  },
  {
    id: "googleCustomProduct",
    label: "Google Shopping / Custom Product",
    group: "Google Shopping",
    description: "Indicates whether the product is custom made.",
    aliases: ["Google Shopping / Custom Product", "Custom Product"],
  },
  {
    id: "googleCustomLabel0",
    label: "Google Shopping / Custom Label 0",
    group: "Google Shopping",
    description: "Google custom label 0.",
    aliases: ["Google Shopping / Custom Label 0", "Custom Label 0"],
  },
  {
    id: "googleCustomLabel1",
    label: "Google Shopping / Custom Label 1",
    group: "Google Shopping",
    description: "Google custom label 1.",
    aliases: ["Google Shopping / Custom Label 1", "Custom Label 1"],
  },
  {
    id: "googleCustomLabel2",
    label: "Google Shopping / Custom Label 2",
    group: "Google Shopping",
    description: "Google custom label 2.",
    aliases: ["Google Shopping / Custom Label 2", "Custom Label 2"],
  },
  {
    id: "googleCustomLabel3",
    label: "Google Shopping / Custom Label 3",
    group: "Google Shopping",
    description: "Google custom label 3.",
    aliases: ["Google Shopping / Custom Label 3", "Custom Label 3"],
  },
  {
    id: "googleCustomLabel4",
    label: "Google Shopping / Custom Label 4",
    group: "Google Shopping",
    description: "Google custom label 4.",
    aliases: ["Google Shopping / Custom Label 4", "Custom Label 4"],
  },

  {
    id: "includedInternational",
    label: "Included / International",
    group: "Markets and pricing",
    description: "Indicates whether the product is included in the international market.",
    aliases: ["Included / International"],
  },
  {
    id: "priceInternational",
    label: "Price / International",
    group: "Markets and pricing",
    description: "International market price.",
    aliases: ["Price / International"],
  },
  {
    id: "compareAtPriceInternational",
    label: "Compare At Price / International",
    group: "Markets and pricing",
    description: "International compare-at price.",
    aliases: ["Compare At Price / International"],
  },
];

export const SHOPIFY_FIELD_GROUPS: ShopifyFieldGroup[] = [
  "Product",
  "Variant",
  "Image",
  "SEO",
  "Google Shopping",
  "Markets and pricing",
];

export function normalizeColumnName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function createAutomaticMapping(
  headers: string[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedTargets = new Set<string>();

  headers.forEach((header) => {
    const normalizedHeader = normalizeColumnName(header);

    const matchingField = SHOPIFY_IMPORT_FIELDS.find((field) => {
      if (usedTargets.has(field.id)) {
        return false;
      }

      return [field.label, ...field.aliases].some(
        (alias) => normalizeColumnName(alias) === normalizedHeader,
      );
    });

    mapping[header] = matchingField?.id ?? "";

    if (matchingField) {
      usedTargets.add(matchingField.id);
    }
  });

  return mapping;
}

export function getShopifyField(
  fieldId: string,
): ShopifyImportField | undefined {
  return SHOPIFY_IMPORT_FIELDS.find((field) => field.id === fieldId);
}