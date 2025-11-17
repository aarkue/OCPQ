export function getRandomStringColor(s: string, saturation = 80, lightness = 50) {
    // return '#292d2a';
    // console.log(s);
    // Demo mode:
    if(s === "item" || s === "items"){
        return "#ff9358"
    }
    if(s === "employee" || s === "employees"){
        return "#fb7fe1"
    }
    if(s === "order" || s === "orders"){
        return "#529ad1"
    }
    if(s === "customer" || s === "customers"){
        return "#4b7e31"
    }
    let h =  14;
    for(let i = 0; i < s.length; i++){
        h = Math.imul(31, h) + (s.charCodeAt(i)) | 0;
    }
    h = h%360;
    if(h<0){
        h += 360
    }
    let ret = `hsl(${h},${saturation}%,${lightness}%)`;
    return ret;
}

