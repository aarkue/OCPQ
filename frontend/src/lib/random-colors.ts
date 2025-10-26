export function getRandomStringColor(s: string, saturation = 80, lightness = 50) {
    // return '#292d2a';
    // console.log(s);
    // Demo mode:
    if(s === "item"){
        return "#ff9358"
    }
    if(s === "employee"){
        return "#fb7fe1"
    }
    if(s === "order"){
        return "#529ad1"
    }
    if(s === "customer"){
        return "#69bbac"
    }
    let h =  14;
    for(let i = 0; i < s.length; i++){
        h = Math.imul(31, h) + (s.charCodeAt(i)) | 0;
    }

    return `hsl(${(h % 360)}, ${saturation}%, ${lightness}%)`;
}

