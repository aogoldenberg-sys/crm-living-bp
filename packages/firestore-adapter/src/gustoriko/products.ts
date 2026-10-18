import type { Db } from "../db.js";
import type { Product, SupplierPricing, Supplier } from "@crm/schemas";
import { Product as ProductSchema, SupplierPricing as PricingSchema, Supplier as SupplierSchema } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

const col = (db: Db, biz: string, name: string) =>
  db.collection(`tenants/${biz}/${name}`);

export async function loadProducts(
  db: Db,
  businessId: string,
): Promise<Result<Product[]>> {
  try {
    const snap = await col(db, businessId, "products").get();
    const products: Product[] = [];
    for (const doc of snap.docs) {
      const p = ProductSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid product id=${doc.id}`, p.error.issues);
        continue;
      }
      products.push(p.data);
    }
    return ok(products);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function saveProduct(
  db: Db,
  businessId: string,
  product: Product,
): Promise<Result<void>> {
  try {
    await col(db, businessId, "products")
      .doc(product.productId)
      .set(product as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadSuppliers(
  db: Db,
  businessId: string,
): Promise<Result<Supplier[]>> {
  try {
    const snap = await col(db, businessId, "suppliers").get();
    const suppliers: Supplier[] = [];
    for (const doc of snap.docs) {
      const p = SupplierSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid supplier id=${doc.id}`, p.error.issues);
        continue;
      }
      suppliers.push(p.data);
    }
    return ok(suppliers);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function saveSupplier(
  db: Db,
  businessId: string,
  supplier: Supplier,
): Promise<Result<void>> {
  try {
    await col(db, businessId, "suppliers")
      .doc(supplier.supplierId)
      .set(supplier as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadSupplierPricing(
  db: Db,
  businessId: string,
): Promise<Result<SupplierPricing[]>> {
  try {
    const snap = await col(db, businessId, "supplier_prices").get();
    const prices: SupplierPricing[] = [];
    for (const doc of snap.docs) {
      const p = PricingSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid pricing id=${doc.id}`, p.error.issues);
        continue;
      }
      prices.push(p.data);
    }
    return ok(prices);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function saveSupplierPricing(
  db: Db,
  businessId: string,
  pricing: SupplierPricing,
): Promise<Result<void>> {
  try {
    const docId = `${pricing.productId}_${pricing.supplierId}`;
    await col(db, businessId, "supplier_prices")
      .doc(docId)
      .set(pricing as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}
