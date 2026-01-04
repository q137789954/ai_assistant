
const ModeSwitch = () => {

    const modes = [
        { label: 'Roast battle', value: 'default' },
        { label: 'Let’s rant together', value: 'creative' },
        { label: 'Regional beef', value: 'professional' },
    ];


  return (
    <div className="flex justify-center items-center gap-2 overflow-x-scroll pl-8 py-2">
        {
            modes.map((mode) => (
                <div key={mode.value} className="px-4 py-2 bg-black/10 backdrop-blur-lg! rounded-full text-sm cursor-pointer shrink-0 whitespace-nowrap hover:bg-black/20 transition">
                    {mode.label}
                </div>
            ))  
        }
    </div>
  );
};

export default ModeSwitch;