import { ReactNode } from "react";

export function MinMaxDisplayWithSugar({
    min,
    max,
    children,
    rangeMode,
}: {
    min: number | null;
    max: number | null;
    children?: ReactNode;
    rangeMode?: boolean;
}) {
    const value = { min: min === 0 ? null : min, max: max };
    if (max === 0) {
        value.min = 0;
    }
    return (
        <>
            {value.max === value.min && value.min !== null && (
                <>
                    {children} = {value.min}
                </>
            )}
            {value.max === null && value.min !== null && (
                <>
                    {children} ≥ {value.min}
                </>
            )}
            {value.min === null && value.max !== null && (
                <>
                    {children} ≤ {value.max}
                </>
            )}
            {((value.min === null && value.max === null) ||
                (value.min !== value.max &&
                    value.min !== null &&
                    value.max !== null)) && (
                    <>
                        {rangeMode === true && (
                            <>
                                {value.min ?? 0} - {value.max ?? "∞"}
                            </>
                        )}
                        {rangeMode !== true && (
                            <>
                                {value.min ?? 0} ≤ {children} ≤ {value.max ?? "∞"}
                            </>
                        )}
                    </>
                )}
            { }
        </>
    );
}