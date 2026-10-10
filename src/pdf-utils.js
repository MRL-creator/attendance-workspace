export function pdfTextItemsToRows(items) {
  const positioned=(items||[]).filter(item=>typeof item.str==='string'&&item.str.trim()&&Array.isArray(item.transform)&&Number.isFinite(item.transform[4])&&Number.isFinite(item.transform[5])).map(item=>({x:item.transform[4],y:item.transform[5],width:Number(item.width)||0,text:item.str.trim()})).sort((a,b)=>b.y-a.y||a.x-b.x);
  const lines=[];
  for(const item of positioned){let line=lines.find(candidate=>Math.abs(candidate.y-item.y)<=2.5);if(!line){line={y:item.y,items:[]};lines.push(line);}line.items.push(item);}
  return lines.sort((a,b)=>b.y-a.y).map(line=>{
    const parts=[];for(const item of line.items.sort((a,b)=>a.x-b.x)){const previous=parts.at(-1);if(!previous){parts.push({x:item.x,right:item.x+item.width,text:item.text});continue;}const gap=item.x-previous.right;if(gap>=12){parts.push({x:item.x,right:item.x+item.width,text:item.text});}else{const separator=gap>1.5&&!/[\s-]$/.test(previous.text)&&!/^[,.;:)]/.test(item.text)?' ':'';previous.text+=separator+item.text;previous.right=Math.max(previous.right,item.x+item.width);}}
    return parts.map(part=>part.text.trim());
  }).filter(row=>row.some(cell=>cell));
}
