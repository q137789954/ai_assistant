import { signIn, signOut, useSession } from "next-auth/react";

const Tabbar = () => {

    const { data: session } = useSession();

    console.log(session)

    const {user} =  session || {};

    const { name='' } = user || {};


    return (
        <div className="flex justify-between p-4">
            <div className="w-9 h-9 rounded-full border-2 border-[rgb(204,255,0)] flex items-center justify-center font-bold text-[rgb(204,255,0)] cursor-pointer">
                {(name).charAt(0)}
            </div>
        </div>
    )
}

export default Tabbar;