import * as XLSX from "xlsx";
import type { AppSettings } from "../lib/appSettings";
import { desktopApi } from "../lib/desktopApi";
import { csvCell } from "../lib/fileSave";
import "./common.css";

interface Props { settings: AppSettings; }
type TemplateFormat="csv"|"xlsx"|"json";

const PRODUCT_HEADERS=["Handle","Title","Body (HTML)","Vendor","Product Category","Type","Tags","Published","Gift Card","Collections","Option1 Name","Option1 Value","Option1 Linked To","Option2 Name","Option2 Value","Option2 Linked To","Option3 Name","Option3 Value","Option3 Linked To","Variant SKU","Variant Grams","Variant Inventory Tracker","Variant Inventory Qty","Variant Inventory Policy","Variant Fulfillment Service","Variant Price","Variant Compare At Price","Variant Requires Shipping","Variant Taxable","Variant Barcode","Image Src","Image Position","Image Alt Text","Variant Image","Variant Weight Unit","Variant Tax Code","Cost per item","SEO Title","SEO Description","Google Shopping / Google Product Category","Google Shopping / Gender","Google Shopping / Age Group","Google Shopping / MPN","Google Shopping / Condition","Google Shopping / Custom Product","Metafield: custom.material [single_line_text_field]","Metafield: custom.technical_details [multi_line_text_field]","Status"];
const COLLECTION_HEADERS=["Handle","Title","Body (HTML)","Sort Order","Template Suffix","Image Src","Image Alt Text","SEO Title","SEO Description","Source Count","Source Types","Target Types","Has Conditions","Has Manual Selections","Has Exclusions","Has Sub-Collections","Has App Sources","Is Hybrid","Inclusion Match Types","Exclusion Match Types","Inclusion Conditions JSON","Inclusion Selections JSON","Exclusion Conditions JSON","Exclusion Selections JSON","Sub-Collections JSON","Sources JSON","Metafield: custom.menu_title [single_line_text_field]"];

function rowsFor(kind:string):Record<string,unknown>[] {
 if(kind==="product-blank") return [];
 if(kind==="product-variants") return [
  {Handle:"example-shirt",Title:"Example Shirt","Body (HTML)":"<p>Example product description.</p>",Vendor:"Hausone",Type:"Shirts",Tags:"example, apparel",Published:"FALSE","Option1 Name":"Color","Option1 Value":"Black","Option2 Name":"Size","Option2 Value":"S","Variant SKU":"EX-SHIRT-BLK-S","Variant Inventory Qty":10,"Variant Price":29.9,"Image Src":"https://example.com/product-black.jpg","Status":"draft"},
  {Handle:"example-shirt","Option1 Value":"Black","Option2 Value":"M","Variant SKU":"EX-SHIRT-BLK-M","Variant Inventory Qty":12,"Variant Price":29.9,"Variant Image":"https://example.com/product-black.jpg","Status":"draft"},
  {Handle:"example-shirt","Option1 Value":"White","Option2 Value":"S","Variant SKU":"EX-SHIRT-WHT-S","Variant Inventory Qty":8,"Variant Price":29.9,"Variant Image":"https://example.com/product-white.jpg","Status":"draft"},
 ];
 if(kind==="product-metafields") return [{Handle:"metafield-example",Title:"Metafield Example",Vendor:"Hausone","Variant SKU":"MF-001","Variant Price":19.9,"Metafield: custom.material [single_line_text_field]":"Stainless steel","Metafield: custom.technical_details [multi_line_text_field]":"Width: 130 mm\nLength: 280 mm",Status:"draft"}];
 if(kind==="collection-blank") return [];
 const sources=[{__typename:"CollectionConditionsSource",title:"Products",description:null,app:null,targetType:"PRODUCTS",shareable:true,inclusion:{matchType:"ANY",conditions:[{__typename:"CollectionSourceInclusionConditionProductTag",id:"portable",tagRelation:"TAGGED_WITH",tagValues:["Bauwerkzeuge","HAROMAC"],tagMatchType:"ANY"}],selections:{nodes:[]}},exclusion:{matchType:"ALL",conditions:[],selections:{nodes:[]}}}];
 return [{Handle:"example-hybrid-collection",Title:"Example Hybrid Collection","Body (HTML)":"<p>Example collection.</p>","Sort Order":"BEST_SELLING","Source Count":1,"Source Types":"CollectionConditionsSource","Target Types":"PRODUCTS","Has Conditions":"TRUE","Has Manual Selections":"FALSE","Has Exclusions":"FALSE","Is Hybrid":"FALSE","Inclusion Match Types":"ANY","Inclusion Conditions JSON":JSON.stringify(sources[0].inclusion.conditions),"Inclusion Selections JSON":"[]","Exclusion Conditions JSON":"[]","Exclusion Selections JSON":"[]","Sub-Collections JSON":"[]","Sources JSON":JSON.stringify(sources),"Metafield: custom.menu_title [single_line_text_field]":"Example"}];
}

function headersFor(kind:string){return kind.startsWith("product")?PRODUCT_HEADERS:COLLECTION_HEADERS;}
function nameFor(kind:string){return ({"product-blank":"shopify-product-empty-template","product-variants":"shopify-product-variant-example","product-metafields":"shopify-product-metafield-example","collection-blank":"shopify-hybrid-collection-empty-template","collection-hybrid":"shopify-hybrid-collection-example"} as Record<string,string>)[kind];}
function arrayBufferToBase64(buffer:ArrayBuffer){const bytes=new Uint8Array(buffer);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}

export default function TemplatesPage({settings}:Props){
 async function download(kind:string,format:TemplateFormat){const headers=headersFor(kind);const rows=rowsFor(kind);const base=nameFor(kind);
  if(format==="json"){await desktopApi.saveTextFile(`${base}.json`,JSON.stringify({columns:headers,rows},null,2));return;}
  if(format==="csv"){const delimiter=settings.export.csvDelimiter==="semicolon"?";":settings.export.csvDelimiter==="tab"?"\t":",";const content=[headers.map(v=>csvCell(v,delimiter)).join(delimiter),...rows.map(row=>headers.map(h=>csvCell(row[h]??"",delimiter)).join(delimiter))].join("\r\n");await desktopApi.saveTextFile(`${base}.csv`,`${settings.export.csvEncoding==="utf8-bom"?"\uFEFF":""}${content}`);return;}
  const sheet=XLSX.utils.json_to_sheet(rows,{header:headers});if(rows.length===0)XLSX.utils.sheet_add_aoa(sheet,[headers],{origin:"A1"});const guide=XLSX.utils.aoa_to_sheet([["Usage"],[kind.startsWith("product")?"Upload this file in Product Import.":"Upload this file in Collection Import."],["Keep the exact column names. Status is the final product column."]]);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,kind.startsWith("product")?"Products":"Collections");XLSX.utils.book_append_sheet(book,guide,"Usage");const output=XLSX.write(book,{type:"array",bookType:"xlsx"}) as ArrayBuffer;await desktopApi.saveBinaryFile(`${base}.xlsx`,arrayBufferToBase64(output));}
 const templates=[
  {id:"product-blank",title:"Empty product template",text:"Standard Shopify product columns with Status as the final column.",formats:["csv","xlsx"]},
  {id:"product-variants",title:"Variant product example",text:"One product with color and size variants, SKU, price, inventory, and images.",formats:["csv","xlsx","json"]},
  {id:"product-metafields",title:"Product metafield example",text:"Shows portable product metafield column syntax.",formats:["csv","xlsx","json"]},
  {id:"collection-blank",title:"Empty hybrid collection template",text:"Shopify 2026-07 source-model collection columns.",formats:["csv","xlsx"]},
  {id:"collection-hybrid",title:"Hybrid collection example",text:"Tag conditions and portable Sources JSON example.",formats:["csv","xlsx","json"]},
 ];
 return <div className="page-stack"><section className="page-hero"><div><span className="eyebrow">READY-TO-USE FILES</span><h2>Product and collection templates</h2><p>Download templates that match the desktop import engines and the Shopify hybrid collection model.</p></div><aside><small>TEMPLATES</small><strong>{templates.length}</strong></aside></section><section className="grid-two">{templates.map(item=><article className="page-card" key={item.id}><header><div><h3>{item.title}</h3><p>{item.text}</p></div></header><div className="page-card-body"><div className="toolbar-group">{item.formats.map(format=><button className="button-secondary" key={format} onClick={()=>void download(item.id,format as TemplateFormat)}>{format.toUpperCase()}</button>)}</div></div></article>)}</section><div className="notice notice-warning">Template image URLs are examples and must be replaced with real public URLs before import.</div></div>;
}
